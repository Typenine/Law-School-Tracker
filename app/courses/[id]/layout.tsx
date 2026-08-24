import type { ReactNode } from 'react';
import CourseDocumentOpenRouter from '@/components/CourseDocumentOpenRouter';

export default async function CourseLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <CourseDocumentOpenRouter courseId={id} />
      {children}
    </>
  );
}
