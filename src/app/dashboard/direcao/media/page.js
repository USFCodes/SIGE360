'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  BsBook, BsCamera, BsCheckCircleFill, BsGlobe, BsXCircleFill,
  BsBuilding, BsImages, BsMortarboard, BsChatSquareText, BsJournalBookmark,
  BsArrowUpRight, BsStars, BsArrowRepeat, BsNewspaper, BsEye
} from 'react-icons/bs';
import '../../../../styles/direcao-midia.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api/v1`;

const SECOES = [
  { id: 'informacoes', titulo: 'Identidade', icone: BsBuilding },
  { id: 'album', titulo: 'Galeria', icone: BsImages },
  { id: 'admissoes', titulo: 'Admissões', icone: BsMortarboard },
  { id: 'comentarios', titulo: 'Comunidade', icone: BsChatSquareText },
  { id: 'biblioteca', titulo: 'Biblioteca', icone: BsJournalBookmark },
  { id: 'noticias', titulo: 'Notícias e artigos', icone: BsNewspaper }
];

const DADOS_VAZIOS = {
  informacoes: null,
  fotos: [],
  matriculas_admitidas: [],
  comentarios: [],
  livros: [],
  publicacoes: []
};

async function requestApi(path, options = {}) {
  const formData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...(!formData && options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Não foi possível concluir o pedido (HTTP ${response.status}).`);
  }
  return data;
}

function urlPublico(url) {
  if (!url) return '';
  return url.startsWith('/uploads/') ? `${API_BASE}${url}` : url;
}

export default function DirecaoMidiaWeb() {
  const [dados, setDados] = useState(DADOS_VAZIOS);
  const [formInfo, setFormInfo] = useState({});
  const [secao, setSecao] = useState('informacoes');
  const [aCarregar, setACarregar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState({ texto: '', tipo: '' });
  const [foto, setFoto] = useState({ titulo: '', categoria: '', imagem_url: '', ficheiro: null });
  const [livro, setLivro] = useState({ titulo: '', autor: '', descricao: '', ficheiro_url: '', ficheiro: null });
  const [publicacao, setPublicacao] = useState({
    titulo: '',
    resumo: '',
    conteudo: '',
    categoria: 'Notícia',
    estado: 'publicado',
    imagem_url: '',
    ficheiro: null
  });
  const [recarregando, setRecarregando] = useState(false);

  const carregarDados = useCallback(async () => {
    const resultado = await requestApi('/media/admin');
    const proximo = { ...DADOS_VAZIOS, ...resultado.data };
    setDados(proximo);
    setFormInfo({
      motto: proximo.informacoes?.motto || '',
      endereco: proximo.informacoes?.endereco || '',
      local: proximo.informacoes?.local || '',
      sector: proximo.informacoes?.sector || '',
      regime_periodo: proximo.informacoes?.regime_periodo || '',
      missao: proximo.informacoes?.missao || '',
      visao: proximo.informacoes?.visao || '',
      valor: proximo.informacoes?.valor || ''
    });
  }, []);

  useEffect(() => {
    let ativo = true;
    requestApi('/media/admin')
      .then((resultado) => {
        if (!ativo) return;
        const proximo = { ...DADOS_VAZIOS, ...resultado.data };
        setDados(proximo);
        setFormInfo({
          motto: proximo.informacoes?.motto || '',
          endereco: proximo.informacoes?.endereco || '',
          local: proximo.informacoes?.local || '',
          sector: proximo.informacoes?.sector || '',
          regime_periodo: proximo.informacoes?.regime_periodo || '',
          missao: proximo.informacoes?.missao || '',
          visao: proximo.informacoes?.visao || '',
          valor: proximo.informacoes?.valor || ''
        });
      })
      .catch((error) => {
        if (ativo) setMensagem({ texto: error.message, tipo: 'erro' });
      })
      .finally(() => {
        if (ativo) setACarregar(false);
      });
    return () => { ativo = false; };
  }, []);

  async function executar(acao) {
    setOcupado(true);
    setMensagem({ texto: '', tipo: '' });
    try {
      const resultado = await acao();
      await carregarDados();
      setMensagem({ texto: resultado?.message || 'Alterações guardadas.', tipo: 'sucesso' });
    } catch (error) {
      setMensagem({ texto: error.message, tipo: 'erro' });
    } finally {
      setOcupado(false);
    }
  }

  async function atualizarPainel() {
    setRecarregando(true);
    setMensagem({ texto: '', tipo: '' });
    try {
      await carregarDados();
      setMensagem({ texto: 'Conteúdo atualizado.', tipo: 'sucesso' });
    } catch (error) {
      setMensagem({ texto: error.message, tipo: 'erro' });
    } finally {
      setRecarregando(false);
    }
  }

  function confirmarRemocao(texto) {
    return window.confirm(texto);
  }

  async function guardarInformacoes(event) {
    event.preventDefault();
    await executar(() => requestApi('/media/informacoes', {
      method: 'PUT',
      body: JSON.stringify(formInfo)
    }));
  }

  async function adicionarFoto(event) {
    event.preventDefault();
    const formData = new FormData();
    formData.append('titulo', foto.titulo);
    formData.append('categoria', foto.categoria);
    if (foto.ficheiro) formData.append('ficheiro', foto.ficheiro);
    else formData.append('imagem_url', foto.imagem_url);

    await executar(async () => {
      const resultado = await requestApi('/media/fotos', { method: 'POST', body: formData });
      setFoto({ titulo: '', categoria: '', imagem_url: '', ficheiro: null });
      event.target.reset();
      return resultado;
    });
  }

  async function adicionarLivro(event) {
    event.preventDefault();
    const formData = new FormData();
    formData.append('titulo', livro.titulo);
    formData.append('autor', livro.autor);
    formData.append('descricao', livro.descricao);
    if (livro.ficheiro) formData.append('ficheiro', livro.ficheiro);
    else formData.append('ficheiro_url', livro.ficheiro_url);

    await executar(async () => {
      const resultado = await requestApi('/media/livros', { method: 'POST', body: formData });
      setLivro({ titulo: '', autor: '', descricao: '', ficheiro_url: '', ficheiro: null });
      event.target.reset();
      return resultado;
    });
  }

  async function criarPublicacao(event) {
    event.preventDefault();
    const formData = new FormData();
    formData.append('titulo', publicacao.titulo);
    formData.append('resumo', publicacao.resumo);
    formData.append('conteudo', publicacao.conteudo);
    formData.append('categoria', publicacao.categoria);
    formData.append('estado', publicacao.estado);
    if (publicacao.ficheiro) formData.append('ficheiro', publicacao.ficheiro);
    else formData.append('imagem_url', publicacao.imagem_url);

    await executar(async () => {
      const resultado = await requestApi('/media/publicacoes', { method: 'POST', body: formData });
      setPublicacao({
        titulo: '',
        resumo: '',
        conteudo: '',
        categoria: 'Notícia',
        estado: 'publicado',
        imagem_url: '',
        ficheiro: null
      });
      event.target.reset();
      return resultado;
    });
  }

  function abrirPortal() {
    const subdominio = dados.informacoes?.subdominio;
    if (subdominio) window.open(`${window.location.origin}/${encodeURIComponent(subdominio)}`, '_blank', 'noopener,noreferrer');
  }

  if (aCarregar) {
    return (
      <div className="midia-page-container midia-loading-state">
        <span className="midia-loading-mark"><BsStars /></span>
        <strong>A preparar o estúdio de mídia</strong>
        <span>A carregar os dados reais da sua escola...</span>
      </div>
    );
  }

  return (
    <div className="midia-page-container">
      <header className="midia-header midia-studio-hero">
        <div className="midia-hero-copy">
          <span className="midia-eyebrow"><BsStars /> ESTÚDIO DE CONTEÚDO <span>·</span> DIREÇÃO</span>
          <h1>A voz da sua escola,<br /><em>em todos os canais.</em></h1>
          <p>Conte histórias, partilhe conquistas e aproxime a comunidade escolar — tudo num só lugar.</p>
          <div className="midia-hero-meta">
            <span className={dados.informacoes?.subdominio ? 'midia-live-indicator is-live' : 'midia-live-indicator'}>
              <i /> {dados.informacoes?.subdominio ? 'Portal ligado' : 'Portal por configurar'}
            </span>
            <span className="midia-school-name">{dados.informacoes?.nome || 'Escola ativa'}</span>
          </div>
        </div>
        <div className="midia-hero-actions">
          <button type="button" className="midia-refresh-button" onClick={atualizarPainel} disabled={recarregando}>
            <BsArrowRepeat className={recarregando ? 'is-spinning' : ''} /> Atualizar
          </button>
          <button
            type="button"
            className="midia-btn-link-site"
            onClick={abrirPortal}
            disabled={!dados.informacoes?.subdominio}
          >
            <BsGlobe size={16} /> Abrir portal <BsArrowUpRight />
          </button>
        </div>
        <div className="midia-hero-decoration" aria-hidden="true">
          <span className="midia-orbit orbit-one" />
          <span className="midia-orbit orbit-two" />
          <BsStars />
        </div>
      </header>

      {mensagem.texto && (
        <div className={`midia-alert ${mensagem.tipo}`} role="status">
          {mensagem.tipo === 'sucesso' ? <BsCheckCircleFill /> : <BsXCircleFill />}
          <span>{mensagem.texto}</span>
        </div>
      )}

      <section className="midia-overview" aria-label="Resumo de mídia">
        <div className="midia-overview-heading">
          <div><span>O seu espaço</span><h2>Visão geral</h2></div>
          <span className="midia-overview-note">O conteúdo é publicado no portal da escola</span>
        </div>
        <div className="midia-stats-grid">
          <article className="midia-stat-card stat-gallery">
            <span className="midia-stat-icon"><BsImages /></span>
            <div><span>Álbum</span><strong>{dados.fotos.length}</strong><small>{dados.fotos.length === 1 ? 'fotografia' : 'fotografias'}</small></div>
          </article>
          <article className="midia-stat-card stat-admissions">
            <span className="midia-stat-icon"><BsMortarboard /></span>
            <div><span>Admissões</span><strong>{dados.matriculas_admitidas.length}</strong><small>registos aprovados</small></div>
          </article>
          <article className="midia-stat-card stat-community">
            <span className="midia-stat-icon"><BsChatSquareText /></span>
            <div><span>Comunidade</span><strong>{dados.comentarios.filter((item) => item.estado === 'pendente').length}</strong><small>comentários por rever</small></div>
          </article>
          <article className="midia-stat-card stat-library">
            <span className="midia-stat-icon"><BsJournalBookmark /></span>
            <div><span>Biblioteca</span><strong>{dados.livros.length}</strong><small>{dados.livros.length === 1 ? 'recurso' : 'recursos'}</small></div>
          </article>
          <article className="midia-stat-card stat-news">
            <span className="midia-stat-icon"><BsNewspaper /></span>
            <div><span>Publicações</span><strong>{dados.publicacoes.filter((item) => item.estado === 'publicado').length}</strong><small>artigos no portal</small></div>
          </article>
        </div>
      </section>

      <nav className="midia-tabs" aria-label="Secções de mídia">
        {SECOES.map((item) => {
          const Icon = item.icone;
          const count = item.id === 'album' ? dados.fotos.length
            : item.id === 'admissoes' ? dados.matriculas_admitidas.length
              : item.id === 'comentarios' ? dados.comentarios.length
                : item.id === 'biblioteca' ? dados.livros.length
                  : item.id === 'noticias' ? dados.publicacoes.length : null;
          return (
          <button
            type="button"
            key={item.id}
            className={secao === item.id ? 'midia-tab active' : 'midia-tab'}
            onClick={() => setSecao(item.id)}
          >
            <Icon />
            <span>{item.titulo}</span>
            {count !== null && <small>{count}</small>}
          </button>
          );
        })}
      </nav>

      {secao === 'informacoes' && (
        <section className="midia-card">
          <div className="midia-card-header">
            <div>
              <h3><BsGlobe /> Informações institucionais</h3>
              <p>Dados atuais da escola. Nome e subdomínio são geridos pelo Owner.</p>
            </div>
          </div>
          <div className="web-config-grid midia-school-summary">
            <div className="web-info-box"><span>Escola</span><strong>{dados.informacoes?.nome || '—'}</strong></div>
            <div className="web-info-box"><span>Subdomínio</span><code>{dados.informacoes?.subdominio || 'Não configurado'}</code></div>
          </div>
          <form className="midia-form midia-info-form" onSubmit={guardarInformacoes}>
            <div className="midia-form-grid">
              <div className="midia-form-group">
                <label htmlFor="midia-motto">Slogan</label>
                <input id="midia-motto" maxLength="180" value={formInfo.motto || ''} onChange={(event) => setFormInfo({ ...formInfo, motto: event.target.value })} />
              </div>
              <div className="midia-form-group">
                <label htmlFor="midia-regime">Regime/período</label>
                <input id="midia-regime" maxLength="80" value={formInfo.regime_periodo || ''} onChange={(event) => setFormInfo({ ...formInfo, regime_periodo: event.target.value })} />
              </div>
              <div className="midia-form-group">
                <label htmlFor="midia-local">Localidade</label>
                <input id="midia-local" maxLength="120" value={formInfo.local || ''} onChange={(event) => setFormInfo({ ...formInfo, local: event.target.value })} />
              </div>
              <div className="midia-form-group">
                <label htmlFor="midia-sector">Sector</label>
                <input id="midia-sector" maxLength="120" value={formInfo.sector || ''} onChange={(event) => setFormInfo({ ...formInfo, sector: event.target.value })} />
              </div>
            </div>
            <div className="midia-form-group">
              <label htmlFor="midia-address">Endereço</label>
              <input id="midia-address" maxLength="255" value={formInfo.endereco || ''} onChange={(event) => setFormInfo({ ...formInfo, endereco: event.target.value })} />
            </div>
            <div className="midia-form-grid">
              <div className="midia-form-group">
                <label htmlFor="midia-missao">Missão</label>
                <textarea id="midia-missao" maxLength="255" rows="3" value={formInfo.missao || ''} onChange={(event) => setFormInfo({ ...formInfo, missao: event.target.value })} />
              </div>
              <div className="midia-form-group">
                <label htmlFor="midia-valores">Valores</label>
                <textarea id="midia-valores" maxLength="255" rows="3" value={formInfo.valor || ''} onChange={(event) => setFormInfo({ ...formInfo, valor: event.target.value })} />
              </div>
            </div>
            <div className="midia-form-group">
              <label htmlFor="midia-visao">Visão (até 500 palavras)</label>
              <textarea id="midia-visao" rows="4" value={formInfo.visao || ''} onChange={(event) => setFormInfo({ ...formInfo, visao: event.target.value })} />
            </div>
            <div className="midia-form-actions">
              <button className="midia-btn-pri" type="submit" disabled={ocupado}>Guardar informações</button>
            </div>
          </form>
        </section>
      )}

      {secao === 'album' && (
        <section className="midia-card">
          <div className="midia-card-header">
            <div>
              <h3><BsCamera /> Álbum de fotos</h3>
              <p>As fotos adicionadas são publicadas no portal da escola.</p>
            </div>
          </div>
          <form className="midia-form midia-add-form" onSubmit={adicionarFoto}>
            <div className="midia-form-grid">
              <div className="midia-form-group">
                <label htmlFor="foto-titulo">Título *</label>
                <input id="foto-titulo" required maxLength="180" value={foto.titulo} onChange={(event) => setFoto({ ...foto, titulo: event.target.value })} />
              </div>
              <div className="midia-form-group">
                <label htmlFor="foto-categoria">Categoria</label>
                <input id="foto-categoria" maxLength="80" value={foto.categoria} onChange={(event) => setFoto({ ...foto, categoria: event.target.value })} />
              </div>
            </div>
            <div className="midia-form-grid">
              <div className="midia-form-group">
                <label htmlFor="foto-file">Carregar imagem (JPEG, PNG ou WebP, até 10 MB)</label>
                <input id="foto-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFoto({ ...foto, ficheiro: event.target.files?.[0] || null })} />
              </div>
              <div className="midia-form-group">
                <label htmlFor="foto-url">Ou URL HTTPS da imagem</label>
                <input id="foto-url" type="url" value={foto.imagem_url} onChange={(event) => setFoto({ ...foto, imagem_url: event.target.value, ficheiro: null })} />
              </div>
            </div>
            <div className="midia-form-actions">
              <button className="midia-btn-pri" type="submit" disabled={ocupado}>Adicionar ao álbum</button>
            </div>
          </form>
          {dados.fotos.length ? (
            <div className="midia-photos-grid">
              {dados.fotos.map((item) => (
                <article key={item.id} className="midia-photo-card">
                  <Image src={urlPublico(item.imagem_url)} alt={item.titulo} fill sizes="(max-width: 640px) 100vw, 33vw" unoptimized />
                  <div className="midia-photo-overlay">
                    {item.categoria && <span className="midia-photo-tag">{item.categoria}</span>}
                    <h4>{item.titulo}</h4>
                    <button type="button" className="midia-delete-button" disabled={ocupado} onClick={() => {
                      if (confirmarRemocao('Remover esta foto do portal?')) {
                        executar(() => requestApi(`/media/fotos/${encodeURIComponent(item.id)}`, { method: 'DELETE' }));
                      }
                    }}>Remover</button>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="midia-empty">Ainda não há fotos neste álbum.</p>}
        </section>
      )}

      {secao === 'admissoes' && (
        <section className="midia-card">
          <div className="midia-card-header">
            <div>
              <h3>Publicação de admitidos</h3>
              <p>O portal mostra apenas o número de matrícula e o ano letivo, nunca o nome do aluno.</p>
            </div>
          </div>
          {dados.matriculas_admitidas.length ? (
            <div className="midia-record-list">
              {dados.matriculas_admitidas.map((item) => (
                <article key={item.id} className="midia-record-row">
                  <div>
                    <strong>{item.numero_matricula}</strong>
                    <span>{item.ano_nome}</span>
                  </div>
                  <button
                    type="button"
                    className={item.publicada ? 'midia-btn-sec' : 'midia-btn-pri'}
                    disabled={ocupado}
                    onClick={() => executar(() => requestApi(`/media/admissoes/${encodeURIComponent(item.id)}/publicacao`, {
                      method: 'PUT',
                      body: JSON.stringify({ publicada: !item.publicada })
                    }))}
                  >
                    {item.publicada ? 'Retirar do portal' : 'Publicar referência'}
                  </button>
                </article>
              ))}
            </div>
          ) : <p className="midia-empty">Não existem matrículas aprovadas disponíveis para publicação.</p>}
        </section>
      )}

      {secao === 'comentarios' && (
        <section className="midia-card">
          <div className="midia-card-header">
            <div>
              <h3>Comentários do portal</h3>
              <p>Todos os comentários enviados pelos visitantes ficam privados até serem aprovados.</p>
            </div>
          </div>
          {dados.comentarios.length ? (
            <div className="midia-record-list">
              {dados.comentarios.map((item) => (
                <article key={item.id} className="midia-comment-row">
                  <div className="midia-comment-content">
                    <div className="midia-comment-title">
                      <strong>{item.nome}</strong>
                      <span className={`midia-status ${item.estado}`}>{item.estado}</span>
                    </div>
                    <p>{item.comentario}</p>
                    <small>{new Date(item.criado_em).toLocaleString('pt-PT')}</small>
                  </div>
                  <div className="midia-row-actions">
                    {item.estado !== 'aprovado' && (
                      <button type="button" className="midia-btn-pri" disabled={ocupado} onClick={() => executar(() => requestApi(`/media/comentarios/${encodeURIComponent(item.id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ estado: 'aprovado' })
                      }))}>Aprovar</button>
                    )}
                    {item.estado === 'pendente' && (
                      <button type="button" className="midia-btn-sec" disabled={ocupado} onClick={() => executar(() => requestApi(`/media/comentarios/${encodeURIComponent(item.id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ estado: 'rejeitado' })
                      }))}>Rejeitar</button>
                    )}
                    <button type="button" className="midia-delete-button" disabled={ocupado} onClick={() => {
                      if (confirmarRemocao('Apagar este comentário permanentemente?')) {
                        executar(() => requestApi(`/media/comentarios/${encodeURIComponent(item.id)}`, { method: 'DELETE' }));
                      }
                    }}>Apagar</button>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="midia-empty">Ainda não há comentários enviados pelos visitantes.</p>}
        </section>
      )}

      {secao === 'biblioteca' && (
        <section className="midia-card">
          <div className="midia-card-header">
            <div>
              <h3><BsBook /> Biblioteca escolar</h3>
              <p>Adicione referências e ficheiros PDF para consulta no portal.</p>
            </div>
          </div>
          <form className="midia-form midia-add-form" onSubmit={adicionarLivro}>
            <div className="midia-form-grid">
              <div className="midia-form-group">
                <label htmlFor="livro-titulo">Título *</label>
                <input id="livro-titulo" required maxLength="180" value={livro.titulo} onChange={(event) => setLivro({ ...livro, titulo: event.target.value })} />
              </div>
              <div className="midia-form-group">
                <label htmlFor="livro-autor">Autor</label>
                <input id="livro-autor" maxLength="180" value={livro.autor} onChange={(event) => setLivro({ ...livro, autor: event.target.value })} />
              </div>
            </div>
            <div className="midia-form-group">
              <label htmlFor="livro-descricao">Descrição</label>
              <textarea id="livro-descricao" rows="3" maxLength="1200" value={livro.descricao} onChange={(event) => setLivro({ ...livro, descricao: event.target.value })} />
            </div>
            <div className="midia-form-grid">
              <div className="midia-form-group">
                <label htmlFor="livro-file">Carregar PDF (até 10 MB)</label>
                <input id="livro-file" type="file" accept="application/pdf,.pdf" onChange={(event) => setLivro({ ...livro, ficheiro: event.target.files?.[0] || null })} />
              </div>
              <div className="midia-form-group">
                <label htmlFor="livro-url">Ou URL HTTPS</label>
                <input id="livro-url" type="url" value={livro.ficheiro_url} onChange={(event) => setLivro({ ...livro, ficheiro_url: event.target.value, ficheiro: null })} />
              </div>
            </div>
            <div className="midia-form-actions">
              <button className="midia-btn-pri" type="submit" disabled={ocupado}>Adicionar à biblioteca</button>
            </div>
          </form>
          {dados.livros.length ? (
            <div className="midia-record-list">
              {dados.livros.map((item) => (
                <article key={item.id} className="midia-record-row">
                  <div className="midia-book-info">
                    <strong>{item.titulo}</strong>
                    {item.autor && <span>{item.autor}</span>}
                    {item.descricao && <p>{item.descricao}</p>}
                  </div>
                  <div className="midia-row-actions">
                    {item.ficheiro_url && <a className="midia-btn-sec" href={urlPublico(item.ficheiro_url)} target="_blank" rel="noreferrer">Abrir</a>}
                    <button type="button" className="midia-delete-button" disabled={ocupado} onClick={() => {
                      if (confirmarRemocao('Remover este livro da biblioteca pública?')) {
                        executar(() => requestApi(`/media/livros/${encodeURIComponent(item.id)}`, { method: 'DELETE' }));
                      }
                    }}>Remover</button>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="midia-empty">A biblioteca ainda não tem livros cadastrados.</p>}
        </section>
      )}

      {secao === 'noticias' && (
        <section className="midia-card">
          <div className="midia-card-header">
            <div>
              <h3><BsNewspaper /> Notícias e artigos</h3>
              <p>Escreva publicações completas para o portal: título, resumo, texto e imagem de capa.</p>
            </div>
          </div>
          <form className="midia-form midia-add-form midia-publication-form" onSubmit={criarPublicacao}>
            <div className="midia-form-grid">
              <div className="midia-form-group">
                <label htmlFor="publicacao-titulo">Título *</label>
                <input
                  id="publicacao-titulo"
                  required
                  minLength="4"
                  maxLength="180"
                  placeholder="Ex.: A nossa escola celebra a Semana da Leitura"
                  value={publicacao.titulo}
                  onChange={(event) => setPublicacao({ ...publicacao, titulo: event.target.value })}
                />
              </div>
              <div className="midia-form-grid midia-publication-meta">
                <div className="midia-form-group">
                  <label htmlFor="publicacao-categoria">Categoria</label>
                  <input
                    id="publicacao-categoria"
                    maxLength="80"
                    placeholder="Notícia, Evento, Comunicado..."
                    value={publicacao.categoria}
                    onChange={(event) => setPublicacao({ ...publicacao, categoria: event.target.value })}
                  />
                </div>
                <div className="midia-form-group">
                  <label htmlFor="publicacao-estado">Publicação</label>
                  <select
                    id="publicacao-estado"
                    value={publicacao.estado}
                    onChange={(event) => setPublicacao({ ...publicacao, estado: event.target.value })}
                  >
                    <option value="publicado">Publicar agora</option>
                    <option value="rascunho">Guardar como rascunho</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="midia-form-group">
              <label htmlFor="publicacao-resumo">Texto de apresentação *</label>
              <textarea
                id="publicacao-resumo"
                required
                minLength="10"
                maxLength="320"
                rows="3"
                placeholder="Uma breve chamada que aparece no cartão do artigo."
                value={publicacao.resumo}
                onChange={(event) => setPublicacao({ ...publicacao, resumo: event.target.value })}
              />
              <small className="midia-field-hint">{publicacao.resumo.length}/320 caracteres</small>
            </div>
            <div className="midia-form-group">
              <label htmlFor="publicacao-conteudo">Texto completo *</label>
              <textarea
                id="publicacao-conteudo"
                className="midia-article-editor"
                required
                minLength="20"
                maxLength="20000"
                rows="10"
                placeholder={'Escreva a notícia ou informação completa.\\n\\nSepare os parágrafos com uma linha em branco.'}
                value={publicacao.conteudo}
                onChange={(event) => setPublicacao({ ...publicacao, conteudo: event.target.value })}
              />
              <small className="midia-field-hint">{publicacao.conteudo.length}/20000 caracteres · Os parágrafos serão preservados no artigo.</small>
            </div>
            <div className="midia-form-grid">
              <div className="midia-form-group">
                <label htmlFor="publicacao-capa">Imagem de capa (JPEG, PNG ou WebP)</label>
                <input
                  id="publicacao-capa"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setPublicacao({ ...publicacao, ficheiro: event.target.files?.[0] || null, imagem_url: '' })}
                />
              </div>
              <div className="midia-form-group">
                <label htmlFor="publicacao-capa-url">Ou endereço HTTPS da capa</label>
                <input
                  id="publicacao-capa-url"
                  type="url"
                  placeholder="https://..."
                  value={publicacao.imagem_url}
                  onChange={(event) => setPublicacao({ ...publicacao, imagem_url: event.target.value, ficheiro: null })}
                />
              </div>
            </div>
            <div className="midia-form-actions">
              <button className="midia-btn-pri" type="submit" disabled={ocupado}>
                {publicacao.estado === 'publicado' ? 'Publicar artigo' : 'Guardar rascunho'}
              </button>
            </div>
          </form>

          <div className="midia-publication-list-heading">
            <div><span>Arquivo editorial</span><h4>As suas publicações</h4></div>
            <span>{dados.publicacoes.length} {dados.publicacoes.length === 1 ? 'artigo' : 'artigos'}</span>
          </div>
          {dados.publicacoes.length ? (
            <div className="midia-publication-list">
              {dados.publicacoes.map((item) => (
                <article className="midia-publication-row" key={item.id}>
                  {item.imagem_url ? (
                    <div className="midia-publication-cover">
                      <Image src={urlPublico(item.imagem_url)} alt="" fill sizes="100px" unoptimized />
                    </div>
                  ) : <div className="midia-publication-cover cover-empty"><BsNewspaper /></div>}
                  <div className="midia-publication-copy">
                    <div className="midia-publication-badges">
                      <span>{item.categoria}</span>
                      <span className={`midia-status ${item.estado}`}>{item.estado}</span>
                    </div>
                    <strong>{item.titulo}</strong>
                    <p>{item.resumo}</p>
                    <small>{new Date(item.criado_em).toLocaleDateString('pt-PT')}</small>
                  </div>
                  <div className="midia-row-actions">
                    <button
                      type="button"
                      className="midia-btn-sec"
                      disabled={ocupado}
                      onClick={() => executar(() => requestApi(`/media/publicacoes/${encodeURIComponent(item.id)}/estado`, {
                        method: 'PATCH',
                        body: JSON.stringify({ estado: item.estado === 'publicado' ? 'rascunho' : 'publicado' })
                      }))}
                    >
                      {item.estado === 'publicado' ? 'Tirar do ar' : 'Publicar'}
                    </button>
                    <button
                      type="button"
                      className="midia-delete-button publication-delete"
                      disabled={ocupado}
                      onClick={() => {
                        if (confirmarRemocao('Apagar esta publicação permanentemente?')) {
                          executar(() => requestApi(`/media/publicacoes/${encodeURIComponent(item.id)}`, { method: 'DELETE' }));
                        }
                      }}
                    >
                      Remover
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="midia-empty">Ainda não publicou artigos. Use o formulário acima para criar a primeira notícia.</p>
          )}
        </section>
      )}
    </div>
  );
}
