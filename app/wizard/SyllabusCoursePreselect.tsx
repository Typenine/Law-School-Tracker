"use client";

import { useEffect } from 'react';

export default function SyllabusCoursePreselect() {
  useEffect(() => {
    const requestedCourseId = new URLSearchParams(window.location.search).get('course');
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
  }, []);

  return null;
}
