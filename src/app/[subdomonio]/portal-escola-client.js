'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  BsBook, BsGeoAlt, BsInfoCircle, BsChatDots, BsArrowRight,
  BsCalendar3, BsJournalText
} from 'react-icons/bs';
import '@/styles/escola-landing.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api/v1`;
const MEDIA_VAZIA = { fotos: [], matriculas_admitidas: [], livros: [], comentarios: [], publicacoes: [] };

export default function EscolaLandingClient({ subdomonio }) {
  const [escolaInfo, setEscolaInfo] = useState(null);
  const [conteudo, setConteudo] = useState(MEDIA_VAZIA);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [erroConteudo, setErroConteudo] = useState('');
  const [comentario, setComentario] = useState({ nome: '', comentario: '' });
  const [mensagemComentario, setMensagemComentario] = useState('');
  const [enviandoComentario, setEnviandoComentario] = useState(false);
  const [artigoAberto, setArtigoAberto] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    async function carregarDadosPublicosEscola() {
      try {
        const [escolaRes, conteudoRes] = await Promise.all([
          fetch(`${API_URL}/accounts/public/escola/${encodeURIComponent(subdomonio)}`, {
            signal: controller.signal, cache: 'no-store'
          }),
          fetch(`${API_URL}/media/public/${encodeURIComponent(subdomonio)}`, {
            signal: controller.signal, cache: 'no-store'
          }).catch((error) => {
            if (error.name !== 'AbortError') {
              console.error('Erro ao carregar as secções do portal:', error);
            }
            return null;
          })
        ]);
        const escolaData = await escolaRes.json();
        if (!escolaRes.ok || !escolaData.success) {
          setErro(escolaData.message || 'Não foi possível encontrar esta escola.');
          return;
        }

        setEscolaInfo(escolaData.data);
        if (!conteudoRes) {
          setErroConteudo('Não foi possível estabelecer ligação às secções do portal.');
          return;
        }
        const conteudoData = await conteudoRes.json().catch(() => ({}));
        if (!conteudoRes.ok || !conteudoData.success) {
          setErroConteudo(conteudoData.message || 'Não foi possível carregar as secções do portal.');
        } else {
          setConteudo({ ...MEDIA_VAZIA, ...conteudoData.data });
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Erro ao carregar dados da escola:', err);
          setErro('Não foi possível carregar os dados da escola. Tente novamente mais tarde.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    carregarDadosPublicosEscola();
    return () => controller.abort();
  }, [subdomonio]);

  async function enviarComentario(event) {
    event.preventDefault();
    setEnviandoComentario(true);
    setMensagemComentario('');
    try {
      const response = await fetch(`${API_URL}/media/public/${encodeURIComponent(subdomonio)}/comentarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(comentario)
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Não foi possível enviar o comentário.');
      }
      setComentario({ nome: '', comentario: '' });
      setMensagemComentario(data.message);
    } catch (err) {
      console.error('Erro ao enviar comentário do portal:', err);
      setMensagemComentario(err.message || 'Não foi possível enviar o comentário.');
    } finally {
      setEnviandoComentario(false);
    }
  }

  if (loading) {
    return <div className="landing-loading">A carregar portal institucional...</div>;
  }

  if (!escolaInfo) {
    return <div className="landing-not-found">{erro || 'Escola não encontrada ou inativa.'}</div>;
  }

  const niveisEnsino = Array.isArray(escolaInfo.niveis_ensino) ? escolaInfo.niveis_ensino : [];
  const temInformacaoInstitucional = Boolean(escolaInfo.missao || escolaInfo.visao || escolaInfo.valor);
  const temGaleria = conteudo.fotos.length > 0;
  const temAdmissoes = conteudo.matriculas_admitidas.length > 0;
  const temBiblioteca = conteudo.livros.length > 0;
  const temPublicacoes = conteudo.publicacoes.length > 0;
  const destinoHero = temPublicacoes
    ? '#publicacoes'
    : temInformacaoInstitucional
      ? '#sobre'
      : temGaleria
        ? '#album'
        : '#programas';
  const publicacaoDestaque = conteudo.publicacoes[0] || null;
  const corPrimaria = /^#[0-9a-f]{6}$/i.test(escolaInfo.cor_primaria || '')
    ? escolaInfo.cor_primaria : '#124b7d';
  const urlPublico = (url) => (
    url?.startsWith('/uploads/') || url?.startsWith('/api/v1/uploads/')
      ? `${API_BASE}${url}`
      : url
  );

  return (
    <div className="escola-landing-container" style={{ '--school-primary': corPrimaria }}>
      <header className="landing-navbar">
        <div className="landing-logo-area">
          {escolaInfo.logo_url ? (
            <Image
              src={escolaInfo.logo_url}
              alt={`Logótipo de ${escolaInfo.nome}`}
              width={48}
              height={48}
              unoptimized
              className="landing-logo-image"
            />
          ) : (
            <span className="landing-sigla">{escolaInfo.sigla}</span>
          )}
          <h2>{escolaInfo.nome}</h2>
        </div>
        <nav className="landing-nav-links">
          <a href="#inicio">Início</a>
          {temPublicacoes && <a href="#publicacoes">Notícias</a>}
          {temInformacaoInstitucional && <a href="#sobre">A escola</a>}
          {temGaleria && <a href="#album">Galeria</a>}
          {niveisEnsino.length > 0 && <a href="#programas">Ensino</a>}
          {temBiblioteca && <a href="#biblioteca">Biblioteca</a>}
        </nav>
        <a className="landing-nav-cta" href={temPublicacoes ? '#publicacoes' : '#contacto'}>
          Explorar a escola <BsArrowRight />
        </a>
      </header>

      <section id="inicio" className="landing-hero">
        <div className="landing-hero-inner">
          <div className="hero-content">
            <span className="badge-oficial"><i /> PORTAL INSTITUCIONAL</span>
            <p className="hero-overline">{escolaInfo.nome}</p>
            <h1>{escolaInfo.motto || 'Um lugar para aprender, crescer e construir o futuro.'}</h1>
            {(escolaInfo.local || escolaInfo.sector) && (
              <p className="hero-location">
                <BsGeoAlt /> {[escolaInfo.sector, escolaInfo.local].filter(Boolean).join(' · ')}
              </p>
            )}
            <div className="hero-buttons">
              <a className="btn-primary-glow" href={destinoHero}>
                Conheça a nossa escola <BsArrowRight />
              </a>
              {temGaleria && <a className="btn-secondary-outline" href="#album">Ver galeria</a>}
            </div>
            <div className="hero-school-facts">
              {niveisEnsino.length > 0 && <span><strong>{niveisEnsino.length}</strong> níveis de ensino</span>}
              {escolaInfo.regime_periodo && <span><BsCalendar3 /> {escolaInfo.regime_periodo}</span>}
            </div>
          </div>
          <div className="landing-hero-art" aria-hidden="true">
            <div className="hero-art-orbit orbit-a" />
            <div className="hero-art-orbit orbit-b" />
            {escolaInfo.logo_url ? (
              <Image src={escolaInfo.logo_url} alt="" width={170} height={170} unoptimized />
            ) : <span>{escolaInfo.sigla}</span>}
          </div>
        </div>
        <a className="hero-scroll-cue" href={temPublicacoes ? '#publicacoes' : '#programas'}>Descubra a escola <span /></a>
      </section>

      {temPublicacoes && (
        <section id="publicacoes" className="landing-section landing-journal-section">
          <div className="landing-section-heading">
            <div>
              <span className="section-kicker">Da nossa comunidade</span>
              <h2>Histórias, ideias e novidades</h2>
              <p>Acompanhe o que acontece na nossa escola.</p>
            </div>
            <span className="journal-edition"><BsJournalText /> JORNAL DA ESCOLA</span>
          </div>
          {publicacaoDestaque && (
            <article className="journal-featured">
              <div className="journal-featured-cover">
                {publicacaoDestaque.imagem_url ? (
                  <Image
                    src={urlPublico(publicacaoDestaque.imagem_url)}
                    alt={publicacaoDestaque.titulo}
                    fill
                    sizes="(max-width: 760px) 100vw, 55vw"
                    unoptimized
                    preload
                  />
                ) : <div className="journal-cover-placeholder"><BsJournalText /></div>}
                <span className="journal-cover-label">EM DESTAQUE</span>
              </div>
              <div className="journal-featured-content">
                <span className="journal-category">{publicacaoDestaque.categoria}</span>
                <span className="journal-date"><BsCalendar3 /> {new Date(publicacaoDestaque.criado_em).toLocaleDateString('pt-PT')}</span>
                <h3>{publicacaoDestaque.titulo}</h3>
                <p>{publicacaoDestaque.resumo}</p>
                <button type="button" onClick={() => setArtigoAberto(publicacaoDestaque)}>
                  Ler artigo <BsArrowRight />
                </button>
              </div>
            </article>
          )}
          {conteudo.publicacoes.length > 1 && (
            <div className="journal-grid">
              {conteudo.publicacoes.slice(1).map((artigo) => (
                <article className="journal-card" key={artigo.id}>
                  <div className="journal-card-cover">
                    {artigo.imagem_url ? (
                      <Image src={urlPublico(artigo.imagem_url)} alt={artigo.titulo} fill sizes="(max-width: 700px) 100vw, 33vw" unoptimized />
                    ) : <div className="journal-cover-placeholder"><BsJournalText /></div>}
                    <span className="journal-category">{artigo.categoria}</span>
                  </div>
                  <div className="journal-card-content">
                    <span className="journal-date"><BsCalendar3 /> {new Date(artigo.criado_em).toLocaleDateString('pt-PT')}</span>
                    <h3>{artigo.titulo}</h3>
                    <p>{artigo.resumo}</p>
                    <button type="button" onClick={() => setArtigoAberto(artigo)}>
                      Continuar a ler <BsArrowRight />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {niveisEnsino.length > 0 && (
        <section id="programas" className="landing-section landing-programs-section">
          <div className="landing-section-heading">
            <div>
              <span className="section-kicker">Aprender com propósito</span>
              <h2>Uma jornada para cada etapa</h2>
              <p>Conheça os níveis de ensino disponíveis na nossa escola.</p>
            </div>
          </div>
          <div className="programs-grid">
            {niveisEnsino.map((nivel) => (
              <article className="program-card" key={nivel.id}>
                <BsBook size={24} />
                <h3>{nivel.nome}</h3>
              </article>
            ))}
          </div>
        </section>
      )}

      {temInformacaoInstitucional && (
        <section id="sobre" className="landing-section landing-about-section alt-bg">
          <div className="landing-section-heading">
            <div>
              <span className="section-kicker">Quem somos</span>
              <h2>Uma escola que acredita em cada potencial</h2>
              <p>{escolaInfo.nome}</p>
            </div>
          </div>
          <div className="about-content-grid">
            {escolaInfo.missao && (
              <article className="about-content-box">
                <h3>Missão</h3>
                <p>{escolaInfo.missao}</p>
              </article>
            )}
            {escolaInfo.visao && (
              <article className="about-content-box">
                <h3>Visão</h3>
                <p>{escolaInfo.visao}</p>
              </article>
            )}
            {escolaInfo.valor && (
              <article className="about-content-box">
                <h3>Valores</h3>
                <p>{escolaInfo.valor}</p>
              </article>
            )}
          </div>
        </section>
      )}

      {erroConteudo && <div className="landing-content-error" role="status">{erroConteudo}</div>}

      {temGaleria && (
        <section id="album" className="landing-section landing-gallery-section">
          <div className="landing-section-heading">
            <div>
              <span className="section-kicker">Momentos que nos unem</span>
              <h2>A vida acontece aqui</h2>
              <p>Um olhar sobre as pessoas, os espaços e as experiências da nossa comunidade.</p>
            </div>
            <span className="gallery-count">{String(conteudo.fotos.length).padStart(2, '0')} MOMENTOS</span>
          </div>
          <div className="landing-photo-grid">
            {conteudo.fotos.map((foto, index) => (
              <figure className={`landing-photo-card${index === 0 ? ' photo-featured' : ''}`} key={foto.id}>
                <Image
                  src={urlPublico(foto.imagem_url)}
                  alt={foto.titulo}
                  fill
                  sizes={index === 0 ? '(max-width: 768px) 100vw, 60vw' : '(max-width: 768px) 100vw, 30vw'}
                  unoptimized
                />
                <figcaption>
                  {foto.categoria && <span>{foto.categoria}</span>}
                  <h3>{foto.titulo}</h3>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {temAdmissoes && (
        <section id="admissoes" className="landing-section alt-bg">
          <div className="landing-section-heading">
            <div>
              <span className="section-kicker">Uma nova etapa começa</span>
              <h2>Referências de alunos admitidos</h2>
              <p>Consulte pelo número de matrícula. Não são publicados nomes ou outros dados pessoais.</p>
            </div>
          </div>
          <div className="landing-admissions-list">
            {conteudo.matriculas_admitidas.map((item, index) => (
              <div className="landing-admission-row" key={`${item.numero_matricula}-${index}`}>
                <strong>{item.numero_matricula}</strong>
                <span>{item.ano_nome}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {temBiblioteca && (
        <section id="biblioteca" className="landing-section">
          <div className="landing-section-heading">
            <div>
              <span className="section-kicker">Leitura e aprendizagem</span>
              <h2>Biblioteca escolar</h2>
              <p>Recursos selecionados para descobrir, estudar e imaginar.</p>
            </div>
          </div>
          <div className="landing-library-grid">
            {conteudo.livros.map((livro) => (
              <article className="landing-library-card" key={livro.id}>
                <BsBook size={24} />
                <h3>{livro.titulo}</h3>
                {livro.autor && <p className="landing-library-author">{livro.autor}</p>}
                {livro.descricao && <p>{livro.descricao}</p>}
                {livro.ficheiro_url && (
                  <a href={urlPublico(livro.ficheiro_url)} target="_blank" rel="noreferrer">
                    {livro.tipo_mime ? 'Abrir documento' : 'Abrir livro'}
                  </a>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <section id="comentarios" className="landing-section alt-bg">
        <div className="landing-section-heading">
          <div>
            <span className="section-kicker">Comunidade escolar</span>
            <h2><BsChatDots /> Uma conversa aberta</h2>
            <p>Os comentários enviados são analisados pela Direção antes de serem publicados.</p>
          </div>
        </div>
        {conteudo.comentarios.length > 0 && (
          <div className="landing-comments-list">
            {conteudo.comentarios.map((item) => (
              <article className="landing-comment" key={item.id}>
                <strong>{item.nome}</strong>
                <p>{item.comentario}</p>
              </article>
            ))}
          </div>
        )}
        {!conteudo.comentarios.length && !erroConteudo && (
          <p className="landing-empty">Ainda não há comentários publicados.</p>
        )}
        <form className="landing-comment-form" onSubmit={enviarComentario}>
          <h3>Deixe um comentário</h3>
          <label>
            Nome
            <input
              required
              maxLength="120"
              value={comentario.nome}
              onChange={(event) => setComentario({ ...comentario, nome: event.target.value })}
            />
          </label>
          <label>
            Comentário
            <textarea
              required
              maxLength="1200"
              rows="4"
              value={comentario.comentario}
              onChange={(event) => setComentario({ ...comentario, comentario: event.target.value })}
            />
          </label>
          {mensagemComentario && <p className="landing-comment-message" role="status">{mensagemComentario}</p>}
          <button type="submit" disabled={enviandoComentario}>
            {enviandoComentario ? 'A enviar...' : 'Enviar para moderação'}
          </button>
        </form>
      </section>

      {artigoAberto && (
        <div className="journal-modal-backdrop" role="presentation" onClick={() => setArtigoAberto(null)}>
          <article
            className="journal-article-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-article-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="journal-modal-close" type="button" aria-label="Fechar artigo" onClick={() => setArtigoAberto(null)}>×</button>
            {artigoAberto.imagem_url && (
              <div className="journal-modal-cover">
                <Image src={urlPublico(artigoAberto.imagem_url)} alt={artigoAberto.titulo} fill sizes="(max-width: 800px) 100vw, 760px" unoptimized />
              </div>
            )}
            <div className="journal-modal-copy">
              <span className="journal-category">{artigoAberto.categoria}</span>
              <span className="journal-date"><BsCalendar3 /> {new Date(artigoAberto.criado_em).toLocaleDateString('pt-PT')}</span>
              <h2 id="journal-article-title">{artigoAberto.titulo}</h2>
              <p className="journal-modal-summary">{artigoAberto.resumo}</p>
              <div className="journal-article-body">
                {artigoAberto.conteudo.split(/\n\s*\n/).map((paragrafo, index) => (
                  <p key={`${artigoAberto.id}-${index}`}>{paragrafo}</p>
                ))}
              </div>
            </div>
          </article>
        </div>
      )}

      <footer id="contacto" className="landing-footer">
        <div className="footer-info">
          <h3>{escolaInfo.nome}</h3>
          {(escolaInfo.endereco || escolaInfo.sector || escolaInfo.local) && (
            <p>
              <BsGeoAlt />
              {[escolaInfo.endereco, escolaInfo.sector, escolaInfo.local].filter(Boolean).join(', ')}
            </p>
          )}
          {escolaInfo.regime_periodo && (
            <p><BsInfoCircle /> Regime: {escolaInfo.regime_periodo}</p>
          )}
        </div>
        <div className="footer-copy">
          <p>© {new Date().getFullYear()} {escolaInfo.nome} — Powered by <strong>Future-Se</strong>.</p>
        </div>
      </footer>
    </div>
  );
}