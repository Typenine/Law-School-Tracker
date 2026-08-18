import CourseDetailPageClient from '@/components/CourseDetailPageClient';

export const dynamic = 'force-dynamic';

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolved = await params;
  return <CourseDetailPageClient params={resolved} />;
}
