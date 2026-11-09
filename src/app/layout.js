import '@/styles/a1.css';

export const metadata = {
  title: 'FUTURE-SE | Gestão Escolar',
  description: 'Sistema de Integração de Gestão Escolar, Guiné-Bissau',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt">
      <body className="light-theme">
        {children}
      </body>
    </html>
  );
}
