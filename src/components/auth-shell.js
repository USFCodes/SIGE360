import '@/styles/auth-layout.css';

export default function AuthShell({ children }) {
  return (
    <div className="authContainer">
      <main className="authCard">
        <section className="desktopHero">
          <div className="heroContent">
            <p className="heroEyebrow">FUTURE-SE · GESTÃO ESCOLAR</p>
            <h1 id="welcome-title">Bem-vindo</h1>
            <p className="heroHeadline">A sua escola, único sistema</p>
            <p className="heroDescription">
              Uma plataforma segura para aproximar diretores, professores, alunos e famílias em toda a Guiné-Bissau.
            </p>
          </div>
          <div className="circle hero1" />
          <div className="circle hero2" />
          <div className="circle hero3" />
          <p className="heroFooter">Uma gestão mais simples. Uma comunidade mais forte.</p>
        </section>
        <section className="desktopForm">
          <div className="authBox">{children}</div>
        </section>
      </main>
    </div>
  );
}
