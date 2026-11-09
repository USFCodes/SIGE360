'use client';

import Link from 'next/link';
import { BsArrowUpRight, BsReceiptCutoff } from 'react-icons/bs';

export default function AlunoDashboardPage() {
  return (
    <main className="aluno-finance-page">
      <header className="rastreio-header">
        <div>
          <h1>Área do aluno</h1>
          <p>Consulte o seu percurso financeiro e os pagamentos registados pela escola.</p>
        </div>
      </header>
      <Link href="/dashboard/aluno/financas" className="aluno-finance-link">
        <BsReceiptCutoff aria-hidden="true" />
        <span>
          <strong>Abrir a minha conta financeira</strong>
          <small>Veja valores previstos, pagamentos confirmados e saldo por item.</small>
        </span>
        <BsArrowUpRight aria-hidden="true" />
      </Link>
    </main>
  );
}
