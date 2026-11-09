import React from 'react';
import '@/styles/escola-landing.css';

export const metadata = {
  title: 'Portal Institucional | Future-Se',
  description: 'Plataforma oficial de gestão escolar e académica.',
};

export default function SubdomainLayout({ children }) {
  return (
    <div className="subdomain-body-root">
      {children}
    </div>
  );
}