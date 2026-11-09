'use client'; 
import React, { useState, useEffect } from 'react'; 
import GuineaBissauPhoneInput from '@/components/GuineaBissauPhoneInput'; 
import { BsPlus, BsSearch, BsPencilSquare, BsEye, BsPrinter, BsEnvelope, BsTelephone, BsCheckCircle, BsExclamationTriangle, BsPeople, BsPersonDash, BsBuilding } from 'react-icons/bs'; 
import AdminHeader from '@/components/adminHeader'; 
import '../../../../styles/a4.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL; 
const API_URL_OWNER = `${API_BASE}/api/v1/owner`; 
const API_URL_ESCOLAS = `${API_BASE}/api/v1/escolas`; 

export default function GodUsuarios() { 
  const [escolas, setEscolas] = useState([]); 
  const [escolaSelecionada, setEscolaSelecionada] = useState(null); 
  const [polosDaEscola, setPolosDaEscola] = useState([]); 
  const [abaAtiva, setAbaAtiva] = useState("secretaria"); 
  const [utilizadores, setUtilizadores] = useState([]); 
  const [searchEscola, setSearchEscola] = useState(""); 
  const [loading, setLoading] = useState(false); 
  const [loadingUtilizadores, setLoadingUtilizadores] = useState(false); 
  const [salvando, setSalvando] = useState(false); 
  const [erroDetalhe, setErroDetalhe] = useState(""); 
  const [utilizadorEmConsulta, setUtilizadorEmConsulta] = useState(null); 
  const [loadingDetalhe, setLoadingDetalhe] = useState(false); 
  const [isFichaOpen, setIsFichaOpen] = useState(false); 
  const [mensagem, setMensagem] = useState({ texto: "", tipo: "" }); 

  // Estados do Modal de Registo / Edição 
  const [isModalOpen, setIsModalOpen] = useState(false); 
  const [editMode, setEditMode] = useState(false); 
  const [currentUserId, setCurrentUserId] = useState(null); 
  const [formData, setFormData] = useState({ 
    nome: "", email: "", telefone: "", papel: "secretaria", polo_id: "", genero: "Masculino", morada: "", bi_ou_passaporte: "", 
    habilitacao_literaria: "", especialidade: "", regime_trabalho: "", grau_academico: "", anos_experiencia: "", observacoes: "" 
  }); 

  const carregarEscolas = async () => { 
    try { 
      setLoading(true); 
      const lista = []; 
      let totalPaginas = 1; 
      for (let pagina = 1; pagina <= totalPaginas; pagina += 1) { 
        const res = await fetch(`${API_URL_OWNER}/escolas/paginadas?page=${pagina}&limit=100`, { 
          method: 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' } 
        }); 
        const data = await res.json(); 
        if (!res.ok || !data.success) { 
          throw new Error(data.message || "Não foi possível carregar as escolas."); 
        } 
        lista.push(...(Array.isArray(data.data) ? data.data : [])); 
        totalPaginas = Number(data.pagination?.totalPages) || 1; 
      } 
      setEscolas(lista); 
      setEscolaSelecionada((atual) => lista.find((escola) => escola.id === atual?.id) || lista[0] || null); 
    } catch (err) { 
      console.error("Erro ao carregar escolas:", err); 
      setMensagem({ texto: err.message || "Erro ao carregar as escolas.", tipo: "erro" }); 
    } finally { 
      setLoading(false); 
    } 
  }; 

  useEffect(() => { 
    const timer = window.setTimeout(carregarEscolas, 0); 
    return () => window.clearTimeout(timer); 
  }, []); 

  const carregarPolosDaEscola = async (escolaId) => { 
    try { 
      const res = await fetch(`${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaId)}/polos`, { credentials: 'include' }); 
      const data = await res.json(); 
      if (!res.ok || !data.success) { 
        throw new Error(data.message || "Não foi possível carregar os polos da escola."); 
      } 
      setPolosDaEscola(Array.isArray(data.data) ? data.data : []); 
    } catch (err) { 
      console.error("Erro ao carregar polos:", err); 
      setPolosDaEscola([]); 
      setMensagem({ texto: err.message || "Erro ao carregar os polos da escola.", tipo: "erro" }); 
    } 
  }; 

  useEffect(() => { 
    if (!escolaSelecionada) return; 
    const timer = window.setTimeout(() => carregarPolosDaEscola(escolaSelecionada.id), 0); 
    return () => window.clearTimeout(timer); 
  }, [escolaSelecionada]); 

  const carregarFuncionariosDaEscola = async (escolaId, signal) => { 
    try { 
      setLoadingUtilizadores(true); 
      const res = await fetch(`${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaId)}/funcionarios`, { 
        method: 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' }, signal 
      }); 
      const data = await res.json(); 
      if (!res.ok || !data.success) { 
        throw new Error(data.message || "Não foi possível carregar os funcionários."); 
      } 
      setUtilizadores(Array.isArray(data.data) ? data.data : []); 
    } catch (err) { 
      if (err.name === 'AbortError') return; 
      console.error("Erro ao carregar funcionários:", err); 
      setUtilizadores([]); 
      setMensagem({ texto: err.message || "Erro ao carregar os funcionários.", tipo: "erro" }); 
    } finally { 
      if (!signal?.aborted) setLoadingUtilizadores(false); 
    } 
  }; 

  useEffect(() => { 
    if (!escolaSelecionada) return; 
    const controller = new AbortController(); 
    const timer = window.setTimeout( 
      () => carregarFuncionariosDaEscola(escolaSelecionada.id, controller.signal), 0 
    ); 
    return () => { 
      window.clearTimeout(timer); 
      controller.abort(); 
    }; 
  }, [escolaSelecionada]); 

  const utilizadoresFiltradosPorPapel = utilizadores.filter( 
    (u) => (u.papel || '').toLowerCase() === abaAtiva.toLowerCase() 
  ); 
  const totalUtilizadoresAtivos = utilizadores.filter((u) => u.status_ativo).length;

  const abrirModalCriar = () => { 
    setEditMode(false); 
    setCurrentUserId(null); 
    setFormData({ 
      nome: "", email: "", telefone: "", papel: abaAtiva, polo_id: "", genero: "Masculino", morada: "", bi_ou_passaporte: "", 
      habilitacao_literaria: "", especialidade: "", regime_trabalho: "", grau_academico: "", anos_experiencia: "", observacoes: "" 
    }); 
    setIsModalOpen(true); 
    setErroDetalhe(""); 
  }; 

  const abrirModalEditar = async (user) => { 
    setEditMode(true); 
    setCurrentUserId(user.id); 
    setErroDetalhe(""); 
    try { 
      const res = await fetch(`${API_URL_ESCOLAS}/funcionarios/${encodeURIComponent(user.id)}`, { credentials: 'include' }); 
      const data = await res.json(); 
      if (!res.ok || !data.success || !data.data) { 
        throw new Error(data.message || "Não foi possível carregar os dados para edição."); 
      } 
      const d = data.data; 
      setFormData({ 
        nome: d.nome || "", email: d.email || "", telefone: d.telefone || "", papel: d.papel || abaAtiva, polo_id: d.polo_id || "", 
        genero: d.genero || "Masculino", morada: d.morada || "", bi_ou_passaporte: d.bi_ou_passaporte || "", 
        habilitacao_literaria: d.habilitacao_literaria || "", especialidade: d.especialidade || "", regime_trabalho: d.regime_trabalho || "", 
        grau_academico: d.grau_academico || "", anos_experiencia: d.anos_experiencia ?? "", observacoes: d.observacoes || "" 
      }); 
      setPolosDaEscola((polosAtuais) => d.polo_id && !polosAtuais.some((polo) => polo.id === d.polo_id) ? [...polosAtuais, { id: d.polo_id, nome: d.polo_nome || "Polo atual", codigo: d.polo_codigo || "", ativo: false }] : polosAtuais); 
      setIsModalOpen(true); 
    } catch (err) { 
      console.error("Erro ao buscar detalhes para edição:", err); 
      setMensagem({ texto: err.message || "Erro ao carregar os dados para edição.", tipo: "erro" }); 
    } 
  }; 

  const abrirFichaFuncionario = async (user) => { 
    if (!escolaSelecionada) return; 
    setIsFichaOpen(true); 
    setLoadingDetalhe(true); 
    setErroDetalhe(""); 
    setUtilizadorEmConsulta(null); 
    try { 
      const res = await fetch(`${API_URL_ESCOLAS}/funcionarios/${encodeURIComponent(user.id)}`, { credentials: 'include' }); 
      const data = await res.json(); 
      if (!res.ok || !data.success || !data.data) { 
        throw new Error(data.message || "Não foi possível carregar os dados do funcionário."); 
      } 
      setUtilizadorEmConsulta(data.data); 
    } catch (err) { 
      console.error("Erro ao carregar funcionário:", err); 
      setErroDetalhe(err.message || "Erro ao carregar os dados do funcionário."); 
    } finally { 
      setLoadingDetalhe(false); 
    } 
  }; 

  const handleSalvarRegisto = async (e) => { 
    e.preventDefault(); 
    if (!escolaSelecionada) return; 
    try { 
      setSalvando(true); 
      let endpoint = `${API_URL_ESCOLAS}/funcionarios`; 
      let method = "POST"; 
      const payload = { 
        escola_id: escolaSelecionada.id, nome: formData.nome, email: formData.email, telefone: formData.telefone, 
        papel: formData.papel, polo_id: formData.polo_id || null, genero: formData.genero, morada: formData.morada, 
        bi_ou_passaporte: formData.bi_ou_passaporte, habilitacao_literaria: formData.habilitacao_literaria, 
        especialidade: formData.especialidade, regime_trabalho: formData.regime_trabalho, grau_academico: formData.grau_academico, 
        anos_experiencia: formData.anos_experiencia ? parseInt(formData.anos_experiencia, 10) : null, observacoes: formData.observacoes 
      }; 
      if (editMode) { 
        endpoint = `${API_URL_ESCOLAS}/funcionarios/${currentUserId}`; 
        method = "PUT"; 
      } 
      const res = await fetch(endpoint, { 
        method, headers: { "Content-Type": "application/json" }, credentials: 'include', body: JSON.stringify(payload), 
      }); 
      const data = await res.json(); 
      if (res.ok && data.success) { 
        setMensagem({ 
          texto: editMode ? "Funcionário atualizado com sucesso!" : `Funcionário criado. Login ID: ${data.data?.login_id || "não devolvido"}; senha temporária: ${data.data?.password_temporaria || "não devolvida"}.`, 
          tipo: "sucesso" 
        }); 
        setIsModalOpen(false); 
        setErroDetalhe(""); 
        await carregarFuncionariosDaEscola(escolaSelecionada.id); 
        if (editMode) setTimeout(() => setMensagem({ texto: "", tipo: "" }), 4000); 
      } else { 
        setErroDetalhe(data.message || "Não foi possível guardar o funcionário."); 
      } 
    } catch (err) { 
      console.error("Erro ao guardar funcionário:", err); 
      setErroDetalhe("Erro de ligação ao servidor. Verifique a ligação e tente novamente."); 
    } finally { 
      setSalvando(false); 
    } 
  }; 

  const escolasFiltradas = escolas.filter( 
    (e) => (e.nome || "").toLowerCase().includes(searchEscola.toLowerCase()) || (e.sigla || "").toLowerCase().includes(searchEscola.toLowerCase()) 
  ); 

  return ( 
    <div className="owner-users-page">
      <AdminHeader titulo='Gestão de Utilizadores' descricao='Controlo de acessos, polos e equipas institucionais' sumItem={abrirModalCriar} sumItemText="Novo colaborador" aria-label="Adicionar novo colaborador" />
      {mensagem.texto && (
          <div className={`direcao-alert-floating ${mensagem.tipo === 'sucesso' ? 'is-success' : 'is-error'}`}>
              {mensagem.tipo === 'sucesso' ? <BsCheckCircle size={18} /> : <BsExclamationTriangle size={18} />}
              <span>{mensagem.texto}</span>
              <button type="button" onClick={() => setMensagem({ texto: "", tipo: "" })} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', marginLeft: 'auto' }}>×</button>
          </div>
      )}

      <div className="owner-layout">
        <aside className="owner-users-sidebar">
          <div className="owner-users-sidebar-heading">
            <div>
              <h2>Unidades escolares</h2>
            </div>
            <span className="owner-users-school-count">{escolas.length}</span>
          </div>
          <label className="owner-users-search">
            <BsSearch aria-hidden="true" />
            <input type="search" placeholder="Pesquisar escola..." value={searchEscola} onChange={(e) => setSearchEscola(e.target.value)} aria-label="Pesquisar escolas" />
          </label>
          <div className="owner-users-school-list">
            {loading ? (
              <p className="owner-users-list-message">A carregar escolas...</p>
            ) : escolasFiltradas.length === 0 ? (
              <p className="owner-users-list-message">Nenhuma escola encontrada.</p>
            ) : (
              escolasFiltradas.map((escola) => {
                const selecionada = escolaSelecionada?.id === escola.id;
                return (
                  <button
                    type="button"
                    key={escola.id}
                    onClick={() => {
                      setUtilizadores([]);
                      setPolosDaEscola([]);
                      setEscolaSelecionada(escola);
                    }}
                    className={`owner-users-school-item ${selecionada ? 'selected' : ''}`}
                    aria-pressed={selecionada}
                  >
                    <span className="owner-users-school-badge">{escola.sigla || 'ESC'}</span>
                    <span className="owner-users-school-info">
                      <strong>{escola.nome}</strong>
                      <span>{escola.local || 'Guiné-Bissau'}</span>
                    </span>
                    <span className="owner-users-school-arrow" aria-hidden="true">›</span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="owner-users-panel">
          {escolaSelecionada ? (
            <>
              <header className="owner-users-panel-header">
                <div className="owner-users-title-group">
                  <span className="owner-users-eyebrow">Equipa da unidade</span>
                  <h2>{escolaSelecionada.sigla} <span aria-hidden="true">/</span> {escolaSelecionada.nome}</h2>
                  <p>{utilizadores.length} colaborador{utilizadores.length === 1 ? '' : 'es'} · {totalUtilizadoresAtivos} acesso{totalUtilizadoresAtivos === 1 ? '' : 's'} ativo{totalUtilizadoresAtivos === 1 ? '' : 's'}</p>
                </div>
                <div className="owner-users-tabs" role="tablist" aria-label="Filtrar por função">
                  <button type="button" role="tab" aria-selected={abaAtiva === 'secretaria'} onClick={() => setAbaAtiva("secretaria")} className={abaAtiva === 'secretaria' ? 'active' : ''}>
                    Secretaria <span>{utilizadores.filter((u) => (u.papel || '').toLowerCase() === 'secretaria').length}</span>
                  </button>
                  <button type="button" role="tab" aria-selected={abaAtiva === 'professor'} onClick={() => setAbaAtiva("professor")} className={abaAtiva === 'professor' ? 'active' : ''}>
                    Professores <span>{utilizadores.filter((u) => (u.papel || '').toLowerCase() === 'professor').length}</span>
                  </button>
                  <button type="button" role="tab" aria-selected={abaAtiva === 'tesouraria'} onClick={() => setAbaAtiva("tesouraria")} className={abaAtiva === 'tesouraria' ? 'active' : ''}>
                    Tesouraria <span>{utilizadores.filter((u) => (u.papel || '').toLowerCase() === 'tesouraria').length}</span>
                  </button>
                </div>
              </header>

              {loadingUtilizadores ? (
                <div className="owner-users-empty-state" role="status">
                  <span className="owner-users-empty-icon"><BsPeople /></span>
                  <strong>A carregar a equipa</strong>
                  <span>Estamos a obter os colaboradores desta unidade.</span>
                </div>
              ) : utilizadoresFiltradosPorPapel.length > 0 ? (
                <div className="owner-users-table-wrap">
                  <table className="owner-users-table">
                    <thead>
                      <tr>
                        <th>Nome completo</th>
                        <th>Cargo / Polo</th>
                        <th>Contactos</th>
                        <th>Login ID</th>
                        <th>Estado</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {utilizadoresFiltradosPorPapel.map((user) => (
                        <tr key={user.id}>
                          <td className="owner-users-name-cell">
                            <span className="owner-users-avatar" aria-hidden="true">{(user.nome || '?').trim().charAt(0).toUpperCase()}</span>
                            <span>{user.nome}</span>
                          </td>
                          <td>
                            <span className="owner-users-role">{user.papel}</span>
                            {user.polo_nome && <span className="owner-users-polo">Polo: {user.polo_nome}</span>}
                          </td>
                          <td className="owner-users-contact-cell">
                            <span><BsEnvelope /> {user.email || 'Sem email'}</span>
                            <span><BsTelephone /> {user.telefone || 'N/D'}</span>
                          </td>
                          <td><code className="owner-users-login">{user.login_id || 'N/D'}</code></td>
                          <td><span className={`owner-users-status ${user.status_ativo ? 'active' : 'inactive'}`}>{user.status_ativo ? 'Ativo' : 'Inativo'}</span></td>
                          <td>
                            <div className="owner-users-actions">
                              <button type="button" className="owner-users-action" onClick={() => abrirFichaFuncionario(user)} title="Ver ficha do funcionário">
                                <BsEye /> <span>Ver</span>
                              </button>
                              <button type="button" className="owner-users-action" onClick={() => abrirModalEditar(user)} title="Editar funcionário">
                                <BsPencilSquare /> <span>Editar</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="owner-users-empty-state">
                  <span className="owner-users-empty-icon"><BsPersonDash /></span>
                  <strong>Nenhum colaborador nesta categoria</strong>
                  <span>Adicione um utilizador para começar a gerir esta equipa.</span>
                  <button type="button" className="owner-users-empty-action" onClick={abrirModalCriar}>Adicionar colaborador</button>
                </div>
              )}
            </> 
          ) : (
            <div className="owner-users-empty-state">
              <span className="owner-users-empty-icon"><BsBuilding /></span>
              <strong>Escolha uma unidade escolar</strong>
              <span>Selecione uma escola à esquerda para consultar e gerir a respetiva equipa.</span>
            </div>
          )}
        </main>
      </div>

      {/* MODAL DE CRIAÇÃO / EDIÇÃO */} 
      {isModalOpen && ( 
        <div className="modal-admin-overlay" onClick={() => setIsModalOpen(false)}> 
          <div className="modal-admin-box" onClick={(e) => e.stopPropagation()}> 
            <div className="modal-admin-header"> 
              <h2>{editMode ? "Editar Funcionário" : "Registar Novo Funcionário"}</h2> 
              <button className="btn-modal-close" onClick={() => setIsModalOpen(false)}>✕</button> 
            </div> 
            <form onSubmit={handleSalvarRegisto} className="modal-admin-body"> 
              {erroDetalhe && ( 
                <div role="alert"> 
                  {erroDetalhe} 
                </div> 
              )} 

              <div className="ce-field-group"> 
                <label>Nome Completo *</label> 
                <input type="text" required value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} className="ce-input" placeholder="Ex: Carlos Alberto Mendes" /> 
              </div> 

              <div> 
                <div className="ce-field-group"> 
                  <label>Email Institucional</label> 
                  <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="ce-input" placeholder="carlos@escola.gw" /> 
                </div> 
                <div className="ce-field-group"> 
                  <label>Contacto Telefónico *</label> 
                  <GuineaBissauPhoneInput required value={formData.telefone} onChange={(value) => setFormData((current) => ({ ...current, telefone: value }))} className="ce-input" placeholder="+245 95XXXXXX" /> 
                </div> 
              </div> 

              <div> 
                <div className="ce-field-group"> 
                  <label>Cargo / Papel Institucional *</label> 
                  <select value={formData.papel} onChange={(e) => setFormData({ ...formData, papel: e.target.value })} className="ce-select" disabled={editMode}> 
                    <option value="secretaria">Secretaria</option> 
                    <option value="professor">Professor</option> 
                    <option value="tesouraria">Tesouraria</option> 
                  </select> 
                </div> 
                <div className="ce-field-group"> 
                  <label>Polo / Nível de Atuação</label> 
                  <select value={formData.polo_id} onChange={(e) => setFormData({ ...formData, polo_id: e.target.value })} className="ce-select"> 
                    <option value="">-- Central / Sede Geral --</option> 
                    {polosDaEscola.map((p) => ( 
                      <option key={p.id} value={p.id} disabled={p.ativo === false}> 
                        {p.codigo ? `${p.nome} (${p.codigo})` : p.nome}{p.ativo === false ? " (inativo)" : ""} 
                      </option> 
                    ))} 
                  </select> 
                </div> 
              </div> 

              <div> 
                <div className="ce-field-group"> 
                  <label>Género</label> 
                  <select value={formData.genero} onChange={(e) => setFormData({ ...formData, genero: e.target.value })} className="ce-select"> 
                    <option value="Masculino">Masculino</option> 
                    <option value="Feminino">Feminino</option> 
                  </select> 
                </div> 
                <div className="ce-field-group"> 
                  <label>Morada</label> 
                  <input type="text" value={formData.morada} onChange={(e) => setFormData({ ...formData, morada: e.target.value })} className="ce-input" placeholder="Bairro / Sector" /> 
                </div> 
                <div className="ce-field-group"> 
                  <label>BI / Passaporte</label> 
                  <input type="text" value={formData.bi_ou_passaporte} onChange={(e) => setFormData({ ...formData, bi_ou_passaporte: e.target.value })} className="ce-input" placeholder="Nº Documento" /> 
                </div> 
              </div> 

              {/* SE FOR PROFESSOR, EXIBIR AS 6 INFORMAÇÕES ESPECÍFICAS */} 
              {formData.papel === 'professor' && ( 
                <div> 
                  <h4>Detalhes Pedagógicos do Professor</h4> 
                  <div> 
                    <div className="ce-field-group"> 
                      <label>Habilitação Literária</label> 
                      <input type="text" value={formData.habilitacao_literaria} onChange={(e) => setFormData({ ...formData, habilitacao_literaria: e.target.value })} className="ce-input" placeholder="Ex: Licenciatura" /> 
                    </div> 
                    <div className="ce-field-group"> 
                      <label>Especialidade</label> 
                      <input type="text" value={formData.especialidade} onChange={(e) => setFormData({ ...formData, especialidade: e.target.value })} className="ce-input" placeholder="Ex: Matemática" /> 
                    </div> 
                    <div className="ce-field-group"> 
                      <label>Regime de Trabalho</label> 
                      <input type="text" value={formData.regime_trabalho} onChange={(e) => setFormData({ ...formData, regime_trabalho: e.target.value })} className="ce-input" placeholder="Ex: Integral / Parcial" /> 
                    </div> 
                    <div className="ce-field-group"> 
                      <label>Grau Académico</label> 
                      <input type="text" value={formData.grau_academico} onChange={(e) => setFormData({ ...formData, grau_academico: e.target.value })} className="ce-input" placeholder="Ex: Mestre / Licenciado" /> 
                    </div> 
                    <div className="ce-field-group"> 
                      <label>Anos de Experiência</label> 
                      <input type="number" value={formData.anos_experiencia} onChange={(e) => setFormData({ ...formData, anos_experiencia: e.target.value })} className="ce-input" placeholder="Ex: 5" /> 
                    </div> 
                    <div className="ce-field-group"> 
                      <label>Observações</label> 
                      <input type="text" value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="ce-input" placeholder="Notas adicionais" /> 
                    </div> 
                  </div> 
                </div> 
              )} 

              <div> 
                <button type="button" onClick={() => { setIsModalOpen(false); setErroDetalhe(""); }} className="ce-btn-back" disabled={salvando}>Cancelar</button> 
                <button type="submit" className="ce-btn-submit" disabled={salvando}> 
                  {salvando ? "A guardar..." : editMode ? "Guardar Alterações" : "Criar e Gerar Acesso"} 
                </button> 
              </div> 
            </form> 
          </div> 
        </div> 
      )} 

      {/* FICHA DO FUNCIONÁRIO */} 
      {isFichaOpen && ( 
        <div className="modal-admin-overlay" onClick={() => { setIsFichaOpen(false); setUtilizadorEmConsulta(null); setErroDetalhe(""); }}> 
          <div id="printable-funcionario-ficha" className="modal-admin-box funcionario-print" onClick={(e) => e.stopPropagation()}> 
            <div className="modal-admin-header"> 
              <div> 
                <h2>Ficha do funcionário</h2> 
                <p>{escolaSelecionada?.nome || 'Escola'}</p> 
              </div> 
              <button className="btn-modal-close" onClick={() => { setIsFichaOpen(false); setUtilizadorEmConsulta(null); setErroDetalhe(""); }} aria-label="Fechar ficha">✕</button> 
            </div> 

            <div className="modal-admin-body funcionario-print-content"> 
              {erroDetalhe && ( 
                <div role="alert"> 
                  {erroDetalhe} 
                </div> 
              )} 

              {loadingDetalhe ? ( 
                <p role="status">A carregar os dados do funcionário...</p> 
              ) : !utilizadorEmConsulta ? ( 
                <p role="alert">{erroDetalhe || "Não foi possível carregar os dados do funcionário."}</p> 
              ) : ( 
                <> 
                  <div className="funcionario-print-title"> 
                    <h1>Future-Se</h1> 
                    <p>Ficha individual de funcionário</p> 
                  </div> 

                  <div className="funcionario-print-grid"> 
                    <div><span>Nome completo: </span><strong>{utilizadorEmConsulta.nome}</strong></div> 
                    <div><span>Cargo / Papel: </span><strong>{utilizadorEmConsulta.papel}</strong></div> 
                    <div><span>Login ID: </span><code>{utilizadorEmConsulta.login_id}</code></div> 
                    <div><span>Polo: </span><strong>{utilizadorEmConsulta.polo_nome || 'Central / Sede'}</strong></div> 
                    <div><span>Estado: </span><strong>{utilizadorEmConsulta.status_ativo ? 'Ativo' : 'Inativo'}</strong></div> 
                    <div><span>Email: </span><strong>{utilizadorEmConsulta.email}</strong></div> 
                    <div><span>Telefone: </span><strong>{utilizadorEmConsulta.telefone}</strong></div> 
                    <div><span>Género: </span><strong>{utilizadorEmConsulta.genero || 'N/D'}</strong></div> 
                    <div><span>Morada: </span><strong>{utilizadorEmConsulta.morada || 'N/D'}</strong></div> 
                    <div><span>BI / Passaporte: </span><strong>{utilizadorEmConsulta.bi_ou_passaporte || 'N/D'}</strong></div> 
                  </div> 

                  {utilizadorEmConsulta.papel === 'professor' && ( 
                    <div> 
                      <h4>Detalhes Pedagógicos</h4> 
                      <div> 
                        <div><span>Habilitação: </span><strong>{utilizadorEmConsulta.habilitacao_literaria || 'N/D'}</strong></div> 
                        <div><span>Especialidade: </span><strong>{utilizadorEmConsulta.especialidade || 'N/D'}</strong></div> 
                        <div><span>Regime: </span><strong>{utilizadorEmConsulta.regime_trabalho || 'N/D'}</strong></div> 
                        <div><span>Grau: </span><strong>{utilizadorEmConsulta.grau_academico || 'N/D'}</strong></div> 
                        <div><span>Experiência: </span><strong>{utilizadorEmConsulta.anos_experiencia ? `${utilizadorEmConsulta.anos_experiencia} anos` : 'N/D'}</strong></div> 
                      </div> 
                    </div> 
                  )} 
                </> 
              )} 
            </div> 

            {!loadingDetalhe && ( 
              <div className="modal-footer-actions funcionario-print-actions"> 
                <button type="button" onClick={() => { setIsFichaOpen(false); setUtilizadorEmConsulta(null); setErroDetalhe(""); }} className="ce-btn-back">Fechar</button> 
                <button type="button" onClick={() => window.print()} className="ce-btn-submit" disabled={Boolean(erroDetalhe || !utilizadorEmConsulta)}> 
                  <BsPrinter /> Imprimir ficha 
                </button> 
              </div> 
            )} 
          </div> 
        </div> 
      )} 
    </div> 
  ); 
}