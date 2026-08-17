import { createHash } from 'crypto';
import type { Pool } from 'pg';
import { clampLimit, ensureNotesSchema, notesDb, toNoteSummary } from './db';
import { getSectionPaths } from './navigation';
import type { AiNoteSummary, NoteFilters } from './types';

export interface HybridNoteSearchResult extends AiNoteSummary {
  excerpt: string;
  score: number;
  lexicalScore: number;
  semanticScore: number | null;
  retrievalMode: 'hybrid' | 'lexical';
  /** Notebook/course plus every nested section, e.g. Evidence / Case Briefs / Week 3. */
  locationPath: string;
}

type Candidate = {
  summary: AiNoteSummary;
  content: string;
  lexicalRaw: number;
  locationPath: string;
};

type ChunkSpec = {
  noteId: string;
  index: number;
  text: string;
  excerpt: string;
  hash: string;
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_CANDIDATE_NOTES = 300;
const CHUNK_CHARS = 6000;
const CHUNK_OVERLAP = 600;
const MAX_CHUNKS_PER_NOTE = 6;
const EMBEDDING_BATCH_SIZE = 64;

let embeddingSchemaReady: Promise<void> | null = null;

function clean(value: string | null | undefined): string {
  return (value || '').trim();
}

function addFilters(input: NoteFilters, clauses: string[], values: unknown[]): void {
  if (clean(input.notebookId)) {
    values.push(clean(input.notebookId));
    clauses.push(`note.notebook_id = $${values.length}`);
  }
  if (clean(input.course)) {
    values.push(`%${clean(input.course)}%`);
    clauses.push(`note.course ILIKE $${values.length}`);
  }
  if (clean(input.semester)) {
    values.push(clean(input.semester));
    clauses.push(`note.semester = $${values.length}`);
  }
  if (input.sectionIds?.length) {
    values.push(Array.from(new Set(input.sectionIds.map(clean).filter(Boolean))));
    clauses.push(`note.section_id = ANY($${values.length}::text[])`);
  } else if (clean(input.sectionId)) {
    values.push(clean(input.sectionId));
    clauses.push(`note.section_id = $${values.length}`);
  }
  if (clean(input.section)) {
    values.push(clean(input.section));
    clauses.push(`LOWER(note.section) = LOWER($${values.length})`);
  }
  if (clean(input.taskId)) {
    values.push(clean(input.taskId));
    clauses.push(`note.task_id = $${values.length}`);
  }
  if (clean(input.sourceType)) {
    values.push(clean(input.sourceType));
    clauses.push(`note.source_type = $${values.length}`);
  }
  if (clean(input.topic)) {
    values.push(clean(input.topic));
    clauses.push(`EXISTS (
      SELECT 1 FROM unnest(note.topics) topic
      WHERE LOWER(topic) = LOWER($${values.length})
    )`);
  }
  if (input.pinnedOnly) clauses.push(`note.pinned = TRUE`);
  if (clean(input.from)) {
    values.push(clean(input.from));
    clauses.push(`note.class_date >= $${values.length}::date`);
  }
  if (clean(input.to)) {
    values.push(clean(input.to));
    clauses.push(`note.class_date <= $${values.length}::date`);
  }
  values.push(input.archived === true);
  clauses.push(`note.archived = $${values.length}`);
  clauses.push(input.deleted === true ? `note.deleted_at IS NOT NULL` : `note.deleted_at IS NULL`);
}

async function candidatesForSearch(query: string, input: NoteFilters, pool: Pool): Promise<Candidate[]> {
  const values: unknown[] = [];
  const clauses: string[] = [];
  addFilters(input, clauses, values);
  const q = query.trim();
  let lexicalSql = '0::real';
  if (q) {
    values.push(q);
    const qIndex = values.length;
    lexicalSql = `ts_rank_cd(
      to_tsvector('english', COALESCE(note.title,'') || ' ' || COALESCE(note.content,'')),
      websearch_to_tsquery('english', $${qIndex})
    )`;
  }
  const candidateLimit = Math.min(
    MAX_CANDIDATE_NOTES,
    Math.max(80, clampLimit(input.limit, 100, 12) * 18),
  );
  values.push(candidateLimit);
  const result = await pool.query(
    `SELECT note.*, notebook.name AS notebook_name,
       LEFT(note.content, 500) AS preview_text,
       ${lexicalSql} AS lexical_score
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id = note.notebook_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY lexical_score DESC, note.updated_at DESC
     LIMIT $${values.length}`,
    values,
  );
  const sectionPaths = await getSectionPaths(result.rows.map((row: any) => row.section_id), pool);
  return result.rows.map((row: any) => {
    const summary = toNoteSummary(row);
    const sectionPath = summary.sectionId ? (sectionPaths.get(summary.sectionId) || []) : [];
    const pieces = [summary.notebookName || summary.course, ...sectionPath].filter(Boolean) as string[];
    return {
      summary,
      content: String(row.content || ''),
      lexicalRaw: Number(row.lexical_score) || 0,
      locationPath: pieces.join(' / '),
    };
  });
}

function chunkCandidate(candidate: Candidate): ChunkSpec[] {
  const metadata = [
    candidate.summary.title,
    candidate.summary.course ? `Course: ${candidate.summary.course}` : '',
    candidate.summary.semester ? `Semester: ${candidate.summary.semester}` : '',
    candidate.locationPath ? `Location: ${candidate.locationPath}` : '',
    candidate.summary.sourceType ? `Type: ${candidate.summary.sourceType}` : '',
    candidate.summary.topics.length ? `Topics: ${candidate.summary.topics.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  const body = candidate.content.trim();
  const chunks: ChunkSpec[] = [];
  if (!body) {
    const text = metadata || candidate.summary.title;
    chunks.push({
      noteId: candidate.summary.id,
      index: 0,
      text,
      excerpt: candidate.summary.preview,
      hash: createHash('sha256').update(text).digest('hex'),
    });
    return chunks;
  }
  const step = CHUNK_CHARS - CHUNK_OVERLAP;
  for (let start = 0, index = 0; start < body.length && index < MAX_CHUNKS_PER_NOTE; start += step, index++) {
    const slice = body.slice(start, start + CHUNK_CHARS);
    const text = `${metadata}\n\n${slice}`;
    chunks.push({
      noteId: candidate.summary.id,
      index,
      text,
      excerpt: slice.replace(/\s+/g, ' ').trim().slice(0, 900),
      hash: createHash('sha256').update(text).digest('hex'),
    });
  }
  return chunks;
}

async function ensureEmbeddingSchema(): Promise<void> {
  if (!embeddingSchemaReady) {
    embeddingSchemaReady = (async () => {
      await ensureNotesSchema();
      await notesDb().query(`
        CREATE TABLE IF NOT EXISTS ai_note_embedding_chunks (
          note_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          model TEXT NOT NULL,
          excerpt TEXT NOT NULL DEFAULT '',
          embedding JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (note_id, chunk_index)
        )
      `);
      await notesDb().query(`CREATE INDEX IF NOT EXISTS ai_note_embedding_model_idx ON ai_note_embedding_chunks (model)`);
    })().catch(error => {
      embeddingSchemaReady = null;
      throw error;
    });
  }
  return embeddingSchemaReady;
}

async function embedTexts(texts: string[], model: string): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const input = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input, encoding_format: 'float' }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
    const ordered = [...(payload.data || [])].sort((a, b) => a.index - b.index);
    if (ordered.length !== input.length) throw new Error('Embedding response did not match the requested input count.');
    vectors.push(...ordered.map(item => item.embedding));
  }
  return vectors;
}

async function vectorsForChunks(chunks: ChunkSpec[], model: string): Promise<Map<string, number[]>> {
  await ensureEmbeddingSchema();
  const byKey = new Map<string, number[]>();
  if (!chunks.length) return byKey;
  const noteIds = Array.from(new Set(chunks.map(chunk => chunk.noteId)));
  const cached = await notesDb().query(
    `SELECT note_id, chunk_index, content_hash, embedding
     FROM ai_note_embedding_chunks
     WHERE note_id = ANY($1::text[]) AND model = $2`,
    [noteIds, model],
  );
  const expected = new Map(chunks.map(chunk => [`${chunk.noteId}:${chunk.index}`, chunk]));
  for (const row of cached.rows) {
    const key = `${row.note_id}:${row.chunk_index}`;
    const chunk = expected.get(key);
    if (!chunk || row.content_hash !== chunk.hash || !Array.isArray(row.embedding)) continue;
    byKey.set(key, row.embedding.map(Number));
  }

  const missing = chunks.filter(chunk => !byKey.has(`${chunk.noteId}:${chunk.index}`));
  if (missing.length) {
    const fresh = await embedTexts(missing.map(chunk => chunk.text), model);
    for (let index = 0; index < missing.length; index++) {
      const chunk = missing[index];
      const vector = fresh[index];
      byKey.set(`${chunk.noteId}:${chunk.index}`, vector);
      await notesDb().query(
        `INSERT INTO ai_note_embedding_chunks
           (note_id, chunk_index, content_hash, model, excerpt, embedding, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
         ON CONFLICT (note_id, chunk_index) DO UPDATE SET
           content_hash = EXCLUDED.content_hash,
           model = EXCLUDED.model,
           excerpt = EXCLUDED.excerpt,
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`,
        [chunk.noteId, chunk.index, chunk.hash, model, chunk.excerpt, JSON.stringify(vector)],
      );
    }
  }

  const counts = new Map<string, number>();
  for (const chunk of chunks) counts.set(chunk.noteId, Math.max(counts.get(chunk.noteId) || 0, chunk.index + 1));
  for (const [noteId, count] of counts) {
    await notesDb().query(
      `DELETE FROM ai_note_embedding_chunks WHERE note_id = $1 AND chunk_index >= $2`,
      [noteId, count],
    );
  }
  return byKey;
}

function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < length; index++) {
    const av = Number(a[index]) || 0;
    const bv = Number(b[index]) || 0;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }
  if (!aNorm || !bNorm) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function sortWithoutQuery(results: HybridNoteSearchResult[], sort: NoteFilters['sort']): HybridNoteSearchResult[] {
  if (sort === 'oldest') return results.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  if (sort === 'class-date') {
    return results.sort((a, b) => String(b.classDate || '').localeCompare(String(a.classDate || '')) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  return results.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * Connector search: PostgreSQL lexical relevance + OpenAI embedding similarity.
 * If the embedding API is not configured or is temporarily unavailable, the
 * connector remains fully usable and reports lexical mode instead of failing.
 */
export async function hybridSearchAiNotes(
  query: string,
  input: NoteFilters = {},
  overridePool?: Pool,
): Promise<HybridNoteSearchResult[]> {
  await ensureNotesSchema();
  const pool = overridePool || notesDb();
  const candidates = await candidatesForSearch(query, input, pool);
  const limit = clampLimit(input.limit, 100, 12);
  const q = query.trim();
  if (!q) {
    return sortWithoutQuery(candidates.map(candidate => ({
      ...candidate.summary,
      excerpt: candidate.summary.preview,
      score: 0,
      lexicalScore: 0,
      semanticScore: null,
      retrievalMode: 'lexical' as const,
      locationPath: candidate.locationPath,
    })), input.sort).slice(0, limit);
  }

  const qLower = q.toLowerCase();
  const maxRaw = Math.max(0, ...candidates.map(candidate => candidate.lexicalRaw));
  const lexical = new Map<string, number>();
  for (const candidate of candidates) {
    let value = maxRaw > 0 ? candidate.lexicalRaw / maxRaw : 0;
    const title = candidate.summary.title.toLowerCase();
    const body = candidate.content.toLowerCase();
    const topics = candidate.summary.topics.join(' ').toLowerCase();
    if (title.includes(qLower)) value = Math.max(value, 1);
    else if (topics.includes(qLower)) value = Math.max(value, 0.9);
    else if (body.includes(qLower)) value = Math.max(value, 0.8);
    lexical.set(candidate.summary.id, Math.max(0, Math.min(1, value)));
  }

  const semantic = new Map<string, { score: number; excerpt: string }>();
  let semanticAvailable = Boolean(process.env.OPENAI_API_KEY?.trim());
  if (semanticAvailable) {
    try {
      const model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
      const chunks = candidates.flatMap(chunkCandidate);
      const [queryVector] = await embedTexts([q], model);
      const vectors = await vectorsForChunks(chunks, model);
      for (const chunk of chunks) {
        const vector = vectors.get(`${chunk.noteId}:${chunk.index}`);
        if (!vector) continue;
        const similarity = Math.max(0, Math.min(1, cosine(queryVector, vector)));
        const current = semantic.get(chunk.noteId);
        if (!current || similarity > current.score) semantic.set(chunk.noteId, { score: similarity, excerpt: chunk.excerpt });
      }
    } catch (error) {
      semanticAvailable = false;
      console.warn('[gpt/semantic-search] Falling back to lexical search:', (error as Error)?.message || error);
    }
  }

  const results = candidates.map(candidate => {
    const lexicalScore = lexical.get(candidate.summary.id) || 0;
    const semanticMatch = semantic.get(candidate.summary.id);
    const semanticScore = semanticAvailable ? (semanticMatch?.score || 0) : null;
    const pinnedBonus = candidate.summary.pinned ? 0.02 : 0;
    const score = semanticAvailable
      ? (0.68 * (semanticScore || 0)) + (0.30 * lexicalScore) + pinnedBonus
      : lexicalScore + pinnedBonus;
    return {
      ...candidate.summary,
      excerpt: semanticMatch && (semanticMatch.score > lexicalScore || !candidate.summary.preview)
        ? semanticMatch.excerpt
        : candidate.summary.preview,
      score: Math.round(score * 1_000_000) / 1_000_000,
      lexicalScore: Math.round(lexicalScore * 1_000_000) / 1_000_000,
      semanticScore: semanticScore === null ? null : Math.round(semanticScore * 1_000_000) / 1_000_000,
      retrievalMode: semanticAvailable ? 'hybrid' as const : 'lexical' as const,
      locationPath: candidate.locationPath,
    };
  });

  if (input.sort === 'recent' || input.sort === 'oldest' || input.sort === 'class-date') {
    return sortWithoutQuery(results, input.sort).slice(0, limit);
  }
  return results
    .sort((a, b) => b.score - a.score || Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}
