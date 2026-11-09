'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BsArrowClockwise, BsCloudUpload, BsDownload, BsFileEarmarkText,
  BsGlobe2, BsLock, BsSearch, BsShieldCheck, BsFileEarmarkArrowUp
} from 'react-icons/bs';
import AdminHeader from './adminHeader';
import { useGlobalAuth } from '@/utils/globalAuth';
import '@/styles/o1.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api/v1/uploads`;
const DESTINATARIOS = [
  { id: 'direcao', nome: 'Escola / Direção' },
  { id: 'professor', nome: 'Professores' },
  { id: 'tesouraria', nome: 'Tesouraria' },
  { id: 'secretaria', nome: 'Secretaria' },
  { id: 'owner', nome: 'Owner' }
];
const FORMULARIO_INICIAL = {
  titulo: '',
  descricao: '',
  visibilidade: 'privado',
  destinatarios: []
};

async function respostaApi(response) {
  const texto = await response.text();
  let dados;
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`A API respondeu num formato inválido (HTTP ${response.status}).`);
  }
  if (!response.ok || dados.success !== true) {
    throw new Error(dados.message || `Falha no pedido (HTTP ${response.status}).`);
  }
  return dados;
}

function formatarData(valor) {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleString('pt-PT');
}

function formatarTamanho(bytes) {
  if (!Number.isFinite(Number(bytes))) return '—';
  const tamanho = Number(bytes);
  return tamanho < 1024 * 1024
    ? `${Math.max(1, Math.round(tamanho / 1024))} KB`
    : `${(tamanho / (1024 * 1024)).toFixed(1)} MB`;
}

function nomePapel(papel) {
  return DESTINATARIOS.find((item) => item.id === papel)?.nome || papel;
}

async function obterContexto() {
  const resultado = await respostaApi(await fetch(`${API_URL}/contexto`, {
    credentials: 'include',
    cache: 'no-store'
  }));
  return resultado.dados;
}

async function obterFicheiros(escolaId) {
  const query = new URLSearchParams({ escola_id: escolaId });
  const resultado = await respostaApi(await fetch(`${API_URL}/ficheiros?${query}`, {
    credentials: 'include',
    cache: 'no-store'
  }));
  return Array.isArray(resultado.dados) ? resultado.dados : [];
}

export default function PartilhaDocumentos() {
  const { userInfo } = useGlobalAuth();
  const [contexto, setContexto] = useState(null);
  const [escolaId, setEscolaId] = useState('');
  const [ficheiros, setFicheiros] = useState([]);
  const [materiaisAntigos, setMateriaisAntigos] = useState([]);
  const [erroMateriaisAntigos, setErroMateriaisAntigos] = useState('');
  const [ficheiroSelecionado, setFicheiroSelecionado] = useState(null);
  const [formulario, setFormulario] = useState(FORMULARIO_INICIAL);
  const [termo, setTermo] = useState('');
  const [carregandoContexto, setCarregandoContexto] = useState(true);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [abrindo, setAbrindo] = useState('');
  const [mensagem, setMensagem] = useState({ texto: '', tipo: '' });

  useEffect(() => {
    let ativo = true;
    obterContexto()
      .then((dados) => {
        if (!ativo) return;
        const idEscola = dados.escola_id || dados.escolas?.[0]?.id || '';
        setContexto(dados);
        setEscolaId((atual) => atual || idEscola);
        setFicheiros([]);
        setCarregandoLista(Boolean(idEscola));
        setMensagem({ texto: '', tipo: '' });
      })
      .catch((error) => {
        if (ativo) setMensagem({ texto: error.message || 'Não foi possível carregar o perfil.', tipo: 'erro' });
      })
      .finally(() => {
        if (ativo) setCarregandoContexto(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    if (!contexto || !escolaId) return undefined;
    let ativo = true;
    obterFicheiros(escolaId)
      .then((dados) => {
        if (ativo) setFicheiros(dados);
      })
      .catch((error) => {
        if (ativo) setMensagem({ texto: error.message || 'Não foi possível carregar os ficheiros.', tipo: 'erro' });
      })
      .finally(() => {
        if (ativo) setCarregandoLista(false);
      });
    return () => {
      ativo = false;
    };
  }, [contexto, escolaId]);

  useEffect(() => {
    if (contexto?.papel !== 'professor') return undefined;
    let ativo = true;
    fetch(`${API_BASE}/api/v1/materias/meus-materiais`, {
      credentials: 'include',
      cache: 'no-store'
    })
      .then(respostaApi)
      .then((resultado) => {
        if (ativo) setMateriaisAntigos(Array.isArray(resultado.dados) ? resultado.dados : []);
      })
      .catch((error) => {
        if (ativo) setErroMateriaisAntigos(error.message || 'Não foi possível carregar os materiais anteriores.');
      });
    return () => {
      ativo = false;
    };
  }, [contexto]);

  const ficheirosFiltrados = useMemo(() => {
    const busca = termo.trim().toLocaleLowerCase();
    if (!busca) return ficheiros;
    return ficheiros.filter((item) =>
      [item.titulo, item.descricao, item.nome_original, item.autor_nome, item.escola_nome]
        .some((valor) => String(valor || '').toLocaleLowerCase().includes(busca))
    );
  }, [ficheiros, termo]);

  async function carregarFicheiros() {
    if (!escolaId) return;
    try {
      setFicheiros(await obterFicheiros(escolaId));
    } catch (error) {
      setMensagem({ texto: error.message || 'Não foi possível carregar os ficheiros.', tipo: 'erro' });
    }
  }

  async function atualizarFicheiros() {
    if (!escolaId) return;
    setCarregandoLista(true);
    try {
      await carregarFicheiros();
    } finally {
      setCarregandoLista(false);
    }
  }

  async function enviarFicheiro(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!ficheiroSelecionado || !escolaId) {
      setMensagem({ texto: 'Selecione uma escola e um ficheiro antes de continuar.', tipo: 'erro' });
      return;
    }
    if (formulario.visibilidade === 'privado' && formulario.destinatarios.length === 0) {
      setMensagem({ texto: 'Selecione pelo menos um perfil destinatário.', tipo: 'erro' });
      return;
    }
    try {
      setEnviando(true);
      setMensagem({ texto: '', tipo: '' });
      const dados = new FormData();
      dados.append('escola_id', escolaId);
      dados.append('titulo', formulario.titulo);
      dados.append('descricao', formulario.descricao);
      dados.append('visibilidade', formulario.visibilidade);
      dados.append('destinatarios', JSON.stringify(formulario.destinatarios));
      dados.append('ficheiro', ficheiroSelecionado);
      const resultado = await respostaApi(await fetch(`${API_URL}/ficheiros`, {
        method: 'POST',
        credentials: 'include',
        body: dados
      }));
      setMensagem({ texto: resultado.message || 'Ficheiro carregado.', tipo: 'sucesso' });
      setFormulario(FORMULARIO_INICIAL);
      setFicheiroSelecionado(null);
      formElement.reset();
      setCarregandoLista(true);
      await carregarFicheiros();
      setCarregandoLista(false);
    } catch (error) {
      setMensagem({ texto: error.message || 'Não foi possível enviar o ficheiro.', tipo: 'erro' });
    } finally {
      setEnviando(false);
    }
  }

  async function abrirFicheiro(item) {
    const novaAba = window.open('about:blank', '_blank');
    if (!novaAba) {
      setMensagem({ texto: 'Permita a abertura de uma nova aba para consultar o ficheiro.', tipo: 'erro' });
      return;
    }
    try {
      setAbrindo(item.id);
      const response = await fetch(`${API_URL}/ficheiros/${encodeURIComponent(item.id)}/ficheiro`, {
        credentials: 'include',
        cache: 'no-store'
      });
      if (!response.ok) {
        const resultado = await respostaApi(response);
        throw new Error(resultado.message || 'Não foi possível abrir o ficheiro.');
      }
      const url = URL.createObjectURL(await response.blob());
      novaAba.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMensagem({ texto: '', tipo: '' });
    } catch (error) {
      novaAba.close();
      setMensagem({ texto: error.message || 'Não foi possível abrir o ficheiro.', tipo: 'erro' });
    } finally {
      setAbrindo('');
    }
  }

  function alternarDestinatario(papel) {
    setFormulario((atual) => ({
      ...atual,
      destinatarios: atual.destinatarios.includes(papel)
        ? atual.destinatarios.filter((item) => item !== papel)
        : [...atual.destinatarios, papel]
    }));
  }

  const totalPublicos = ficheiros.filter((item) => item.visibilidade === 'publico').length;
  const totalPrivados = ficheiros.length - totalPublicos;
  const papelAtual = DESTINATARIOS.find((item) => item.id === contexto?.papel)?.nome || 'Conta institucional';
  const escolaSelecionada = contexto?.escolas?.find((escola) => String(escola.id) === String(escolaId));
  const corInstitucional = escolaSelecionada?.cor_primaria || userInfo?.conta_ativa?.cor_primaria;
  const estiloPartilha = /^#[0-9a-f]{6}$/i.test(corInstitucional || '')
    ? { '--sharing-primary': corInstitucional }
    : undefined;
  return (
    <div className="sharing-page" style={estiloPartilha}>
      <AdminHeader
        titulo="Partilha de ficheiros"
        descricao="Organize documentos e escolha quem pode consultá-los."
        onRefresh={atualizarFicheiros}
        loading={carregandoLista}
      >
        {contexto && <span className="sharing-role-chip"><BsShieldCheck aria-hidden="true" /> {papelAtual}</span>}
      </AdminHeader>

      <main className="sharing-content">
        {mensagem.texto && (
          <div className={`sharing-message ${mensagem.tipo}`} role={mensagem.tipo === 'erro' ? 'alert' : 'status'}>
            {mensagem.tipo === 'sucesso' ? <BsShieldCheck aria-hidden="true" /> : <BsFileEarmarkText aria-hidden="true" />}
            <span>{mensagem.texto}</span>
          </div>
        )}

        {contexto?.papel === 'owner' && (
          <label className="sharing-school-select">
            <span>Escola da partilha</span>
            <select
              value={escolaId}
              onChange={(event) => {
                const novaEscolaId = event.target.value;
                setEscolaId(novaEscolaId);
                setFicheiros([]);
                setCarregandoLista(Boolean(novaEscolaId));
              }}
              required
            >
              <option value="">Selecione uma escola</option>
              {(contexto.escolas || []).map((escola) => (
                <option key={escola.id} value={escola.id}>{escola.nome}{escola.sigla ? ` (${escola.sigla})` : ''}</option>
              ))}
            </select>
          </label>
        )}

        <section className="sharing-summary" aria-label="Resumo dos ficheiros">
          <article className="sharing-summary-card">
            <span className="sharing-summary-icon"><BsFileEarmarkText aria-hidden="true" /></span>
            <span className="sharing-summary-copy"><small>Documentos disponíveis</small><strong>{ficheiros.length}</strong></span>
          </article>
          <article className="sharing-summary-card">
            <span className="sharing-summary-icon is-public"><BsGlobe2 aria-hidden="true" /></span>
            <span className="sharing-summary-copy"><small>Partilhados publicamente</small><strong>{totalPublicos}</strong></span>
          </article>
          <article className="sharing-summary-card">
            <span className="sharing-summary-icon is-private"><BsLock aria-hidden="true" /></span>
            <span className="sharing-summary-copy"><small>Com acesso reservado</small><strong>{totalPrivados}</strong></span>
          </article>
        </section>

        <section className="sharing-workspace">
          <article className="sharing-panel sharing-upload-panel">
            <header className="sharing-panel-header">
              <span className="sharing-panel-icon"><BsCloudUpload aria-hidden="true" /></span>
              <div>
                <span className="sharing-eyebrow">Novo documento</span>
                <h2>Carregar ficheiro</h2>
                <p>Adicione um documento e defina as permissões de acesso.</p>
              </div>
            </header>

            {carregandoContexto ? (
              <div className="sharing-empty" role="status">A preparar a área de partilha…</div>
            ) : (
              <form className="sharing-form" onSubmit={enviarFicheiro}>
                <label className="sharing-field">
                  <span>Título do documento</span>
                  <input
                    value={formulario.titulo}
                    onChange={(event) => setFormulario((atual) => ({ ...atual, titulo: event.target.value }))}
                    maxLength={180}
                    required
                    placeholder="Ex.: Calendário escolar 2026/2027"
                  />
                </label>

                <label className="sharing-field">
                  <span>Descrição <small>Opcional</small></span>
                  <textarea
                    value={formulario.descricao}
                    onChange={(event) => setFormulario((atual) => ({ ...atual, descricao: event.target.value }))}
                    maxLength={2000}
                    rows={3}
                    placeholder="Acrescente uma breve informação sobre este documento"
                  />
                </label>

                <label className="sharing-field">
                  <span>Visibilidade</span>
                  <select
                    value={formulario.visibilidade}
                    onChange={(event) => setFormulario((atual) => ({
                      ...atual,
                      visibilidade: event.target.value,
                      destinatarios: event.target.value === 'publico' ? [] : atual.destinatarios
                    }))}
                  >
                    <option value="privado">Acesso reservado</option>
                    {contexto?.pode_publicar && <option value="publico">Público na internet</option>}
                  </select>
                </label>

                {formulario.visibilidade === 'privado' && (
                  <fieldset className="sharing-recipients">
                    <legend>Perfis com acesso</legend>
                    <p>Selecione os perfis que poderão consultar este ficheiro.</p>
                    <div className="sharing-recipient-options">
                      {DESTINATARIOS.map((destinatario) => (
                        <label key={destinatario.id} className={formulario.destinatarios.includes(destinatario.id) ? 'selected' : ''}>
                          <input
                            type="checkbox"
                            checked={formulario.destinatarios.includes(destinatario.id)}
                            onChange={() => alternarDestinatario(destinatario.id)}
                          />
                          <span>{destinatario.nome}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}

                <label className="sharing-file-field">
                  <span>Ficheiro para carregar</span>
                  <span className="sharing-file-picker">
                    <BsFileEarmarkArrowUp aria-hidden="true" />
                    <span className="sharing-file-copy">
                      <strong>{ficheiroSelecionado?.name || 'Escolha um ficheiro do seu dispositivo'}</strong>
                      <small>PDF, DOCX, JPEG, PNG ou WEBP · Máximo de 15 MB</small>
                    </span>
                    <span className="sharing-file-button">Procurar</span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp"
                      onChange={(event) => setFicheiroSelecionado(event.target.files?.[0] || null)}
                      required
                    />
                  </span>
                </label>

                <button type="submit" className="sharing-submit" disabled={enviando || !escolaId}>
                  <BsCloudUpload aria-hidden="true" />
                  {enviando ? 'A enviar documento…' : 'Partilhar documento'}
                </button>
              </form>
            )}

            {!contexto?.pode_publicar && contexto && (
              <p className="sharing-privacy-note"><BsLock aria-hidden="true" /> O seu perfil pode carregar documentos com acesso reservado.</p>
            )}
          </article>

          <aside className="sharing-side-panel">
            <div className="sharing-access-card">
              <span className="sharing-access-icon"><BsShieldCheck aria-hidden="true" /></span>
              <h2>Partilha segura</h2>
              <p>Os documentos são disponibilizados apenas às pessoas autorizadas pela escola.</p>
            </div>
            <div className="sharing-school-card">
              <span className="sharing-eyebrow">Espaço institucional</span>
              <strong>{escolaSelecionada?.nome || 'Documentos da escola'}</strong>
              <small>{escolaSelecionada?.sigla || (escolaId ? 'Ficheiros partilhados nesta escola' : 'Selecione uma escola para consultar documentos')}</small>
            </div>
          </aside>
        </section>

        <section className="sharing-panel sharing-library">
          <header className="sharing-library-header">
            <div className="sharing-library-title">
              <span className="sharing-panel-icon"><BsFileEarmarkText aria-hidden="true" /></span>
              <div>
                <span className="sharing-eyebrow">Biblioteca escolar</span>
                <h2>Ficheiros partilhados</h2>
                <p>Consulte os documentos disponíveis para o seu perfil.</p>
              </div>
            </div>
            <label className="sharing-search">
              <BsSearch aria-hidden="true" />
              <input value={termo} onChange={(event) => setTermo(event.target.value)} placeholder="Pesquisar ficheiros" aria-label="Pesquisar ficheiros" />
            </label>
          </header>

          {carregandoLista ? (
            <div className="sharing-empty" role="status"><BsArrowClockwise className="sharing-spinner" /> A carregar ficheiros…</div>
          ) : (
            <div className="sharing-table-wrap">
              <table className="sharing-table">
                <thead>
                  <tr><th>Documento</th><th>Permissão</th><th>Partilhado por</th><th>Data</th><th><span className="sharing-visually-hidden">Ações</span></th></tr>
                </thead>
                <tbody>
                  {ficheirosFiltrados.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className="sharing-document-icon"><BsFileEarmarkText aria-hidden="true" /></span>
                        <span className="sharing-document-copy">
                          <strong>{item.titulo}</strong>
                          <small>{item.nome_original} · {formatarTamanho(item.tamanho_bytes)}</small>
                          {item.descricao && <small className="sharing-document-description">{item.descricao}</small>}
                        </span>
                      </td>
                      <td>
                        <span className={`sharing-badge ${item.visibilidade}`}>
                          {item.visibilidade === 'publico' ? <BsGlobe2 aria-hidden="true" /> : <BsLock aria-hidden="true" />}
                          {item.visibilidade === 'publico' ? 'Público' : item.destinatarios.map(nomePapel).join(', ')}
                        </span>
                      </td>
                      <td>{item.autor_nome || '—'}</td>
                      <td className="sharing-date">{formatarData(item.criado_em)}</td>
                      <td>
                        <button type="button" className="sharing-open" onClick={() => void abrirFicheiro(item)} disabled={abrindo === item.id}>
                          <BsDownload aria-hidden="true" /> {abrindo === item.id ? 'A abrir…' : 'Abrir'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!ficheirosFiltrados.length && (
                    <tr><td className="sharing-empty-cell" colSpan={5}>
                      <BsFileEarmarkText aria-hidden="true" />
                      <strong>{ficheiros.length ? 'Nenhum resultado encontrado' : 'Ainda não há documentos partilhados'}</strong>
                      <span>{ficheiros.length ? 'Experimente pesquisar com outro título ou nome.' : 'Os documentos autorizados para si aparecerão aqui.'}</span>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {contexto?.papel === 'professor' && (
          <section className="sharing-panel sharing-legacy">
            <header className="sharing-library-title">
              <span className="sharing-panel-icon"><BsFileEarmarkText aria-hidden="true" /></span>
              <div>
                <span className="sharing-eyebrow">Arquivo anterior</span>
                <h2>Materiais publicados anteriormente</h2>
              </div>
            </header>
            <p className="sharing-legacy-note">Estes materiais foram publicados antes da nova área de partilha e continuam públicos. Os novos documentos podem ser enviados acima.</p>
            {erroMateriaisAntigos && <div className="sharing-message erro" role="alert">{erroMateriaisAntigos}</div>}
            <div className="sharing-table-wrap">
              <table className="sharing-table">
                <thead><tr><th>Material</th><th>Tipo</th><th>Data</th><th>Ação</th></tr></thead>
                <tbody>
                  {materiaisAntigos.map((item) => (
                    <tr key={item.id}>
                      <td><span className="sharing-document-copy"><strong>{item.nome_original}</strong>{item.descricao && <small>{item.descricao}</small>}</span></td>
                      <td><span className="sharing-badge publico"><BsGlobe2 aria-hidden="true" /> Público anterior</span></td>
                      <td className="sharing-date">{formatarData(item.criado_em)}</td>
                      <td><a className="sharing-open" href={`${API_BASE}${item.caminho_ficheiro}`} target="_blank" rel="noreferrer"><BsDownload aria-hidden="true" /> Abrir</a></td>
                    </tr>
                  ))}
                  {!materiaisAntigos.length && !erroMateriaisAntigos && (
                    <tr><td className="sharing-empty-cell" colSpan={4}><strong>Não existem materiais anteriores.</strong></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
