"use client";

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SyllabusCoursePreselect() {
  const searchParams = useSearchParams();
  const requestedCourseId = searchParams.get('course');

  useEffect(() => {
    if (!requestedCourseId) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('main select'));
      const courseSelect = selects.find(select => Array.from(select.options).some(option => option.value === requestedCourseId));
      if (courseSelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(courseSelect, requestedCourseId);
        courseSelect.dispatchEvent(new Event('change', { bubbles: true }));
        window.clearInterval(timer);
      } else if (attempts >= 40) {
        window.clearInterval(timer);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [requestedCourseId]);

  return null;
}
