'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  BsBook,
  BsCalendar3,
  BsCheckCircle,
  BsExclamationTriangle,
  BsGear,
  BsPencilSquare,
  BsPersonCircle,
  BsPlusLg,
  BsShieldCheck,
  BsToggleOff,
  BsToggleOn,
  BsX
} from 'react-icons/bs';
import '../../../../styles/a7.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_V1 = `${API_BASE}/api/v1`;
const API_AUTH = `${API_V1}/auth`;
const API_OWNER_ANOS = `${API_V1}/owner/anos-letivos`;
const API_DISCIPLINAS = `${API_V1}/escolas/disciplinas`;

const secoes = [
  { id: 'anos', titulo: 'Anos letivos', descricao: 'Calendário global do sistema', icon: <BsCalendar3 /> },
  { id: 'disciplinas', titulo: 'Disciplinas', descricao: 'Catálogo partilhado pelas escolas', icon: <BsBook /> },
  { id: 'conta', titulo: 'Conta Owner', descricao: 'Sessão e dados da conta', icon: <BsPersonCircle /> }
];

async function lerRespostaApi(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`O backend respondeu num formato inesperado (HTTP ${response.status}). Confirme a rota da API.`);
  }

  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `O pedido falhou (HTTP ${response.status}).`);
  }
  return data;
}

export default function OwnerConfiguracoes() {
  const [abaAtiva, setAbaAtiva] = useState('anos');
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [alterandoAnoId, setAlterandoAnoId] = useState(null);
  const [anoEmEdicao, setAnoEmEdicao] = useState(null);
  const [mensagem, setMensagem] = useState({ texto: '', tipo: '' });
  const [anosGlobais, setAnosGlobais] = useState([]);
  const [disciplinas, setDisciplinas] = useState([]);
  const [conta, setConta] = useState(null);
  const [formAno, setFormAno] = useState({ ano_nome: '', ativo: false });

  const carregarDados = useCallback(async () => {
    setLoading(true);

    try {
      const [resConta, resAnos, resDisciplinas] = await Promise.all([
        fetch(`${API_AUTH}/me`, { credentials: 'include', cache: 'no-store' }),
        fetch(API_OWNER_ANOS, { credentials: 'include', cache: 'no-store' }),
        fetch(API_DISCIPLINAS, { credentials: 'include', cache: 'no-store' })
      ]);

      const [dadosConta, dadosAnos, dadosDisciplinas] = await Promise.all([
        lerRespostaApi(resConta),
        lerRespostaApi(resAnos),
        lerRespostaApi(resDisciplinas)
      ]);

      if (dadosConta.data?.tipo !== 'owner') {
        throw new Error('A sessão autenticada não pertence a uma conta Owner.');
      }
      if (!Array.isArray(dadosAnos.dados)) {
        throw new Error('O backend não devolveu a lista esperada de anos letivos.');
      }
      if (!Array.isArray(dadosDisciplinas.data)) {
        throw new Error('O backend não devolveu a lista esperada de disciplinas.');
      }

      setConta(dadosConta.data);
      setAnosGlobais(dadosAnos.dados);
      setDisciplinas(dadosDisciplinas.data);
    } catch (error) {
      console.error('Erro ao carregar configurações globais:', error);
      setMensagem({
        texto: error.message || 'Não foi possível carregar os dados de configuração.',
        tipo: 'erro'
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => carregarDados(), 0);
    return () => window.clearTimeout(timer);
  }, [carregarDados]);

  const handleCriarAnoGlobal = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setMensagem({ texto: '', tipo: '' });

    try {
      const data = await lerRespostaApi(await fetch(API_OWNER_ANOS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ano_nome: formAno.ano_nome.trim(),
          ativo: formAno.ativo
        })
      }));

      setFormAno({ ano_nome: '', ativo: false });
      setMensagem({ texto: data.message || 'Ano letivo criado com sucesso.', tipo: 'sucesso' });
      await carregarDados();
    } catch (error) {
      console.error('Erro ao criar ano letivo global:', error);
      setMensagem({ texto: error.message || 'Não foi possível criar o ano letivo.', tipo: 'erro' });
    } finally {
      setSalvando(false);
    }
  };

  const iniciarEdicaoAno = (ano) => {
    setAnoEmEdicao(ano);
    setFormAno({ ano_nome: ano.ano_nome, ativo: Boolean(ano.ativo) });
    setMensagem({ texto: '', tipo: '' });
  };

  const cancelarEdicaoAno = () => {
    setAnoEmEdicao(null);
    setFormAno({ ano_nome: '', ativo: false });
  };

  const handleEditarAnoGlobal = async (event) => {
    event.preventDefault();
    if (!anoEmEdicao) return;

    setSalvando(true);
    setMensagem({ texto: '', tipo: '' });

    try {
      const data = await lerRespostaApi(await fetch(
        `${API_OWNER_ANOS}/${encodeURIComponent(anoEmEdicao.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ano_nome: formAno.ano_nome.trim(),
            ativo: formAno.ativo
          })
        }
      ));

      setAnoEmEdicao(null);
      setFormAno({ ano_nome: '', ativo: false });
      setMensagem({ texto: data.message || 'Ano letivo atualizado com sucesso.', tipo: 'sucesso' });
      await carregarDados();
    } catch (error) {
      console.error('Erro ao editar ano letivo global:', error);
      setMensagem({ texto: error.message || 'Não foi possível editar o ano letivo.', tipo: 'erro' });
    } finally {
      setSalvando(false);
    }
  };

  const handleAlternarAnoAtivo = async (ano) => {
    const ativo = !ano.ativo;
    setAlterandoAnoId(ano.id);
    setMensagem({ texto: '', tipo: '' });

    try {
      const data = await lerRespostaApi(await fetch(`${API_OWNER_ANOS}/${encodeURIComponent(ano.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ativo })
      }));

      setMensagem({
        texto: data.message || `Ano letivo ${ativo ? 'ativado' : 'desativado'} com sucesso.`,
        tipo: 'sucesso'
      });
      await carregarDados();
    } catch (error) {
      console.error('Erro ao atualizar estado do ano letivo:', error);
      setMensagem({ texto: error.message || 'Não foi possível atualizar o ano letivo.', tipo: 'erro' });
    } finally {
      setAlterandoAnoId(null);
    }
  };

  const handleCriarDisciplina = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setMensagem({ texto: '', tipo: '' });

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      nome: String(form.get('nome') || '').trim(),
      codigo: String(form.get('codigo') || '').trim(),
      descricao: String(form.get('descricao') || '').trim(),
      ativa: true
    };

    try {
      const data = await lerRespostaApi(await fetch(API_DISCIPLINAS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      }));

      formElement.reset();
      setMensagem({ texto: data.message || 'Disciplina criada com sucesso.', tipo: 'sucesso' });
      await carregarDados();
    } catch (error) {
      console.error('Erro ao criar disciplina global:', error);
      setMensagem({ texto: error.message || 'Não foi possível criar a disciplina.', tipo: 'erro' });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="owner-config-page">
      
      <header className="owner-config-header">
        <div>
          <span className="owner-config-eyebrow">Administração da plataforma</span>
          <h1>Configurações globais</h1>
          <p>Gira os dados partilhados por todas as escolas a partir do backend central.</p>
        </div>
        <div className="owner-config-header-account">
          <span className="owner-config-account-avatar"><BsPersonCircle /></span>
          <span><strong>{conta?.nome || 'Conta Owner'}</strong><small>Proprietário do sistema</small></span>
          <BsShieldCheck className="owner-config-account-check" aria-label="Sessão autenticada" />
        </div>
      </header>

      <section className="owner-config-summary" aria-label="Resumo do sistema">
        <article className="owner-config-summary-card">
          <span className="owner-config-summary-icon is-blue"><BsCalendar3 /></span>
          <span><small>Anos letivos globais</small><strong>{loading ? '—' : anosGlobais.length}</strong></span>
        </article>
        <article className="owner-config-summary-card">
          <span className="owner-config-summary-icon is-violet"><BsBook /></span>
          <span><small>Disciplinas no catálogo</small><strong>{loading ? '—' : disciplinas.length}</strong></span>
        </article>
        <article className="owner-config-summary-card">
          <span className="owner-config-summary-icon is-green"><BsShieldCheck /></span>
          <span><small>Ligação ao backend</small><strong>{loading ? 'A verificar' : conta ? 'Ligada' : 'Indisponível'}</strong></span>
        </article>
      </section>

      <div className="owner-config-workspace">
        <aside className="owner-config-sidebar">
          <div className="owner-config-sidebar-heading">
            <BsGear />
            <div><strong>Centro de controlo</strong><small>Configurações disponíveis</small></div>
          </div>
          <nav className="owner-config-nav" aria-label="Configurações do Owner">
            {secoes.map((secao) => (
              <button
                key={secao.id}
                type="button"
                className={`owner-config-nav-item${abaAtiva === secao.id ? ' is-active' : ''}`}
                onClick={() => setAbaAtiva(secao.id)}
                aria-current={abaAtiva === secao.id ? 'page' : undefined}
              >
                <span className="owner-config-nav-icon">{secao.icon}</span>
                <span><strong>{secao.titulo}</strong><small>{secao.descricao}</small></span>
                <span className="owner-config-nav-marker" />
              </button>
            ))}
          </nav>
          <div className="owner-config-sidebar-note">
            <BsShieldCheck />
            <p>As alterações efetuadas aqui são guardadas no backend e na base de dados central.</p>
          </div>
        </aside>

        <main className="owner-config-main">
          {mensagem.texto && (
            <div className={`owner-config-message ${mensagem.tipo === 'sucesso' ? 'is-success' : 'is-error'}`} role="status">
              {mensagem.tipo === 'sucesso' ? <BsCheckCircle /> : <BsExclamationTriangle />}
              <span>{mensagem.texto}</span>
              <button type="button" onClick={() => setMensagem({ texto: '', tipo: '' })} aria-label="Fechar mensagem">×</button>
            </div>
          )}

          {loading ? (
            <div className="owner-config-loading"><span className="owner-config-spinner" />A carregar dados reais do backend...</div>
          ) : (
            <>
              {abaAtiva === 'anos' && (
                <section className="owner-config-panel">
                  <div className="owner-config-panel-heading">
                    <div><span className="owner-config-eyebrow">Calendário académico</span><h2>Anos letivos globais</h2><p>Estes registos ficam disponíveis para associação às escolas.</p></div>
                    <span className="owner-config-count">{anosGlobais.length} registos</span>
                  </div>

                  <form
                    className="owner-config-form owner-config-year-form"
                    onSubmit={anoEmEdicao ? handleEditarAnoGlobal : handleCriarAnoGlobal}
                  >
                    <div className="owner-config-field">
                      <label htmlFor="owner-ano-nome">{anoEmEdicao ? 'Editar nome do ano letivo' : 'Nome do ano letivo'}</label>
                      <input
                        id="owner-ano-nome"
                        type="text"
                        value={formAno.ano_nome}
                        onChange={(event) => setFormAno({ ...formAno, ano_nome: event.target.value })}
                        placeholder="Ex.: 2026/2027"
                        required
                      />
                    </div>
                    <label className="owner-config-checkbox">
                      <input
                        type="checkbox"
                        checked={formAno.ativo}
                        onChange={(event) => setFormAno({ ...formAno, ativo: event.target.checked })}
                      />
                      {anoEmEdicao ? 'Ano letivo ativo' : 'Criar como ativo'}
                    </label>
                    <button className="owner-config-primary-button" type="submit" disabled={salvando}>
                      {anoEmEdicao ? <BsPencilSquare /> : <BsPlusLg />}
                      {salvando ? 'A guardar...' : anoEmEdicao ? 'Guardar alterações' : 'Adicionar ano'}
                    </button>
                    {anoEmEdicao && (
                      <button className="owner-config-secondary-button" type="button" onClick={cancelarEdicaoAno} disabled={salvando}>
                        <BsX />Cancelar
                      </button>
                    )}
                  </form>

                  <div className="owner-config-list-heading"><h3>Registos na base de dados</h3><span>Estado alterável</span></div>
                  {anosGlobais.length === 0 ? (
                    <div className="owner-config-empty"><BsCalendar3 /><strong>Ainda não há anos letivos</strong><span>Crie o primeiro registo usando o formulário acima.</span></div>
                  ) : (
                    <div className="owner-config-table-wrap">
                      <table className="owner-config-table">
                        <thead><tr><th>Ano letivo</th><th>Data de criação</th><th>Estado</th><th aria-label="Ações" /></tr></thead>
                        <tbody>
                          {anosGlobais.map((ano) => (
                            <tr key={ano.id}>
                              <td><strong>{ano.ano_nome}</strong><small>Registo #{ano.id}</small></td>
                              <td>{ano.criado_em ? new Date(ano.criado_em).toLocaleDateString('pt-PT') : '—'}</td>
                              <td><span className={`owner-config-status ${ano.ativo ? 'is-active' : 'is-inactive'}`}>{ano.ativo ? 'Ativo' : 'Inativo'}</span></td>
                              <td className="owner-config-row-actions">
                                <button
                                  type="button"
                                  className="owner-config-edit-button"
                                  onClick={() => iniciarEdicaoAno(ano)}
                                  disabled={salvando || alterandoAnoId === ano.id}
                                  aria-label={`Editar ano ${ano.ano_nome}`}
                                >
                                  <BsPencilSquare /><span>Editar</span>
                                </button>
                                <button
                                  type="button"
                                  className={`owner-config-toggle${ano.ativo ? ' is-active' : ''}`}
                                  onClick={() => handleAlternarAnoAtivo(ano)}
                                  disabled={salvando || Boolean(anoEmEdicao) || alterandoAnoId === ano.id}
                                  aria-label={`${ano.ativo ? 'Desativar' : 'Ativar'} ano ${ano.ano_nome}`}
                                >
                                  {ano.ativo ? <BsToggleOn /> : <BsToggleOff />}
                                  <span>{alterandoAnoId === ano.id ? 'A atualizar' : ano.ativo ? 'Desativar' : 'Ativar'}</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {abaAtiva === 'disciplinas' && (
                <section className="owner-config-panel">
                  <div className="owner-config-panel-heading">
                    <div><span className="owner-config-eyebrow">Catálogo académico</span><h2>Disciplinas do sistema</h2><p>Catálogo global lido e guardado no endpoint de disciplinas do backend.</p></div>
                    <span className="owner-config-count">{disciplinas.length} registos</span>
                  </div>

                  <form className="owner-config-form owner-config-discipline-form" onSubmit={handleCriarDisciplina}>
                    <div className="owner-config-field"><label htmlFor="owner-disc-nome">Nome</label><input id="owner-disc-nome" name="nome" placeholder="Ex.: Matemática" required /></div>
                    <div className="owner-config-field"><label htmlFor="owner-disc-codigo">Código</label><input id="owner-disc-codigo" name="codigo" placeholder="Ex.: MAT-01" required /></div>
                    <div className="owner-config-field owner-config-field-wide"><label htmlFor="owner-disc-descricao">Descrição <span>(opcional)</span></label><input id="owner-disc-descricao" name="descricao" placeholder="Breve descrição da disciplina" /></div>
                    <button className="owner-config-primary-button" type="submit" disabled={salvando}>
                      <BsPlusLg />{salvando ? 'A guardar...' : 'Adicionar disciplina'}
                    </button>
                  </form>

                  {disciplinas.length === 0 ? (
                    <div className="owner-config-empty"><BsBook /><strong>Catálogo vazio</strong><span>Adicione uma disciplina para criar o primeiro registo global.</span></div>
                  ) : (
                    <div className="owner-config-discipline-list">
                      {disciplinas.map((disciplina) => (
                        <article className="owner-config-discipline-card" key={disciplina.id}>
                          <span className="owner-config-discipline-icon"><BsBook /></span>
                          <span className="owner-config-discipline-info">
                            <strong>{disciplina.nome}</strong>
                            <small>{disciplina.codigo}{disciplina.descricao ? ` · ${disciplina.descricao}` : ''}</small>
                          </span>
                          <span className={`owner-config-status ${disciplina.ativa ? 'is-active' : 'is-inactive'}`}>{disciplina.ativa ? 'Ativa' : 'Inativa'}</span>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {abaAtiva === 'conta' && (
                <section className="owner-config-panel">
                  <div className="owner-config-panel-heading">
                    <div><span className="owner-config-eyebrow">Sessão autenticada</span><h2>Conta Owner</h2><p>Informações devolvidas pelo endpoint de sessão do backend.</p></div>
                    <span className="owner-config-count is-connected"><BsShieldCheck /> Backend ligado</span>
                  </div>
                  <div className="owner-config-account-grid">
                    <article><small>Nome</small><strong>{conta?.nome || 'Não informado'}</strong></article>
                    <article><small>Email</small><strong>{conta?.email || 'Não informado'}</strong></article>
                    <article><small>Identificador de acesso</small><strong>{conta?.login_id || 'Não informado'}</strong></article>
                    <article><small>Tipo de conta</small><strong>{conta?.tipo || 'Owner'}</strong></article>
                  </div>
                  <div className="owner-config-honesty-note"><BsShieldCheck /><p>A sessão foi validada pelo endpoint <code>/api/v1/auth/me</code>. O backend atual não disponibiliza aqui configurações de DNS, backups ou políticas globais, por isso essas opções não são apresentadas como editáveis.</p></div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
