'use client'; 

import React, { useState, useEffect } from 'react'; 
import GuineaBissauPhoneInput from '@/components/GuineaBissauPhoneInput';
import { BsPlusLg, BsSearch, BsPencilSquare, BsEnvelope, BsTelephone, BsCheckCircle, BsExclamationTriangle, BsGeoAlt } from 'react-icons/bs'; 
import '../../../../styles/a2.css'; 
import '../../../../styles/escolas-admin.css'; 

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/$/, "");
const API_URL = `${API_BASE}/api/v1`;
const API_URL_AUTH = `${API_URL}/auth`;
const API_URL_ESCOLAS = `${API_URL}/escolas`;

export default function DirecaoUsuarios() { 
  const [escolaIdLogada, setEscolaIdLogada] = useState(null);
  const [escolaAtual, setEscolaAtual] = useState(null);
  const [polos, setPolos] = useState([]); 
  const [poloSelecionado, setPoloSelecionado] = useState(null); // null = Todos / Central + Polos
  const [abaAtiva, setAbaAtiva] = useState("secretaria"); // 'secretaria', 'professor', 'tesouraria' 
  const [funcionarios, setFuncionarios] = useState([]); 
  const [searchFuncionario, setSearchFuncionario] = useState(""); 
  const [searchPolo, setSearchPolo] = useState("");
  const [loading, setLoading] = useState(true); 
  const [loadingFuncionarios, setLoadingFuncionarios] = useState(false); 
  const [salvando, setSalvando] = useState(false); 
  const [erroDetalhe, setErroDetalhe] = useState(""); 
  const [utilizadorEmConsulta, setUtilizadorEmConsulta] = useState(null); 
  const [loadingDetalhe, setLoadingDetalhe] = useState(false); 
  const [isFichaOpen, setIsFichaOpen] = useState(false); 
  const [mensagem, setMensagem] = useState({ texto: "", tipo: "" }); 

  // Estados do Modal de Funcionário
  const [isModalOpen, setIsModalOpen] = useState(false); 
  const [editMode, setEditMode] = useState(false); 
  const [currentUserId, setCurrentUserId] = useState(null); 
  const [formData, setFormData] = useState({ 
    nome: "", 
    email: "", 
    telefone: "", 
    papel: "secretaria",
    polo_id: "",
    genero: "Masculino",
    morada: "",
    bi_ou_passaporte: "",
    habilitacao_literaria: "",
    specialidade: "",
    regime_trabalho: "",
    grau_academico: "",
    anos_experiencia: "",
    observacoes: ""
  }); 

  // Estados do Modal para Criar Polo
  const [isPoloModalOpen, setIsPoloModalOpen] = useState(false);
  const [formPolo, setFormPolo] = useState({
    nome: "",
    codigo: "",
    endereco: "",
    local: "",
    telefone: "",
    ativo: true
  });

  const carregarPolos = async (escolaId, signal) => {
    const res = await fetch(`${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaId)}/polos`, {
      credentials: 'include',
      signal
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || "Não foi possível carregar os polos da escola.");
    }
    setPolos(Array.isArray(data.data) ? data.data : []);
  };

  const carregarFuncionarios = async (escolaId, signal) => {
    const res = await fetch(`${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaId)}/funcionarios`, {
      credentials: 'include',
      signal
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || "Não foi possível carregar os funcionários da escola.");
    }
    setFuncionarios(Array.isArray(data.data) ? data.data : []);
  };

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL_AUTH}/me`, {
          credentials: 'include',
          cache: 'no-store'
        });
        const data = await res.json();
        const contaAtiva = data?.data?.conta_ativa;
        if (!res.ok || !data.success || !contaAtiva?.escola_id) {
          throw new Error(data.message || "Não foi encontrada uma escola ativa para esta conta. Volte a selecionar a conta da Direção.");
        }
        setEscolaAtual({
          id: contaAtiva.escola_id,
          nome: contaAtiva.escola_nome,
          sigla: contaAtiva.escola_sigla
        });
        setEscolaIdLogada(contaAtiva.escola_id);
      } catch (err) {
        console.error("Erro ao carregar a escola da conta ativa:", err);
        setMensagem({ texto: err.message || "Não foi possível identificar a escola ativa.", tipo: "erro" });
        setLoading(false);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!escolaIdLogada) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadingFuncionarios(true);
      carregarPolos(escolaIdLogada, controller.signal)
        .catch((err) => {
          if (err.name === 'AbortError') return;
          console.error("Erro ao carregar polos:", err);
          setPolos([]);
          setMensagem({ texto: err.message || "Erro ao carregar os polos.", tipo: "erro" });
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      carregarFuncionarios(escolaIdLogada, controller.signal)
        .catch((err) => {
          if (err.name === 'AbortError') return;
          console.error("Erro ao carregar funcionários:", err);
          setFuncionarios([]);
          setMensagem({ texto: err.message || "Erro ao carregar funcionários.", tipo: "erro" });
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingFuncionarios(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [escolaIdLogada]);

  // Criar novo polo
  const handleCriarPolo = async (e) => {
    e.preventDefault();
    setErroDetalhe("");
    if (!escolaIdLogada) {
      setErroDetalhe("Não foi possível identificar a escola ativa.");
      return;
    }
    try {
      setSalvando(true);
      const res = await fetch(`${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaIdLogada)}/polos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...formPolo,
          nome: formPolo.nome.trim(),
          codigo: formPolo.codigo.trim().toUpperCase()
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Não foi possível criar o polo.");
      }
      setPolos((atuais) => [...atuais, data.data].sort((a, b) => a.nome.localeCompare(b.nome)));
      setIsPoloModalOpen(false);
      setFormPolo({ nome: "", codigo: "", endereco: "", local: "", telefone: "", ativo: true });
      setMensagem({ texto: data.message || "Polo criado com sucesso.", tipo: "sucesso" });
    } catch (err) {
      console.error("Erro ao criar polo:", err);
      setErroDetalhe(err.message || "Erro ao criar polo.");
    } finally {
      setSalvando(false);
    }
  };

  // Filtrar funcionários por aba, polo e barra de pesquisa
  const funcionariosFiltrados = funcionarios.filter((u) => {
    const matchPapel = (u.papel || '').toLowerCase() === abaAtiva.toLowerCase();
    
    // Se poloSelecionado for null, mostra centrais (polo_id === null) e todos os outros, ou filtra pelo polo
    const matchPolo = poloSelecionado === null 
      ? true 
      : (u.polo_id === poloSelecionado || u.polo_id === null); // centrais aparecem em todos

    const matchSearch = (u.nome || '').toLowerCase().includes(searchFuncionario.toLowerCase()) ||
                        (u.email || '').toLowerCase().includes(searchFuncionario.toLowerCase()) ||
                        (u.login_id || '').toLowerCase().includes(searchFuncionario.toLowerCase());

    return matchPapel && matchPolo && matchSearch;
  });

  const polosFiltrados = polos.filter(p => (p.nome || '').toLowerCase().includes(searchPolo.toLowerCase()));

  // Abertura do Modal de Funcionário
  const abrirModalCriar = () => { 
    setEditMode(false); 
    setCurrentUserId(null); 
    setFormData({ 
      nome: "", email: "", telefone: "", papel: abaAtiva,
      polo_id: poloSelecionado || "",
      genero: "Masculino", morada: "", bi_ou_passaporte: "",
      habilitacao_literaria: "", specialidade: "", regime_trabalho: "",
      grau_academico: "", anos_experiencia: "", observacoes: ""
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
        throw new Error(data.message || "Não foi possível carregar os dados do funcionário.");
      }
      const d = data.data;
      setFormData({
        nome: d.nome || "", email: d.email || "", telefone: d.telefone || "",
        papel: d.papel || abaAtiva, polo_id: d.polo_id || "",
        genero: d.genero || "Masculino", morada: d.morada || "",
        bi_ou_passaporte: d.bi_ou_passaporte || "",
        habilitacao_literaria: d.habilitacao_literaria || "",
        specialidade: d.especialidade || "",
        regime_trabalho: d.regime_trabalho || "",
        grau_academico: d.grau_academico || "",
        anos_experiencia: d.anos_experiencia ?? "",
        observacoes: d.observacoes || ""
      });
      setIsModalOpen(true);
    } catch (err) {
      console.error("Erro ao buscar detalhes:", err);
      setMensagem({ texto: err.message || "Erro ao carregar os dados do funcionário.", tipo: "erro" });
    }
  }; 

  const handleSalvarRegisto = async (e) => { 
    e.preventDefault(); 
    if (!escolaIdLogada) {
      setErroDetalhe("Não foi possível identificar a escola ativa desta conta.");
      return;
    }
    try { 
      setErroDetalhe("");
      setSalvando(true); 
      let endpoint = `${API_URL_ESCOLAS}/funcionarios`; 
      let method = "POST"; 
      
      const payload = { 
        escola_id: escolaIdLogada, 
        nome: formData.nome, email: formData.email, telefone: formData.telefone, 
        papel: formData.papel, polo_id: formData.polo_id || null,
        genero: formData.genero, morada: formData.morada, bi_ou_passaporte: formData.bi_ou_passaporte,
        habilitacao_literaria: formData.habilitacao_literaria, especialidade: formData.specialidade,
        regime_trabalho: formData.regime_trabalho, grau_academico: formData.grau_academico,
        anos_experiencia: formData.anos_experiencia !== "" ? parseInt(formData.anos_experiencia, 10) : null,
        observacoes: formData.observacoes
      }; 

      if (editMode) { 
        endpoint = `${API_URL_ESCOLAS}/funcionarios/${currentUserId}`; 
        method = "PUT"; 
      } 

      const res = await fetch(endpoint, { 
        method, headers: { "Content-Type": "application/json" }, 
        credentials: 'include', body: JSON.stringify(payload), 
      }); 

      const data = await res.json(); 
      if (res.ok && data.success) {
        const credenciais = data.data;
        setMensagem({ 
          texto: editMode
            ? "Funcionário atualizado com sucesso!"
            : `Funcionário criado. Login ID: ${credenciais?.login_id || "não devolvido"}; senha temporária: ${credenciais?.password_temporaria || "não devolvida"}.`,
          tipo: "sucesso" 
        }); 
        setIsModalOpen(false); 
        setErroDetalhe(""); 
        await carregarFuncionarios(escolaIdLogada);
        if (editMode) setTimeout(() => setMensagem({ texto: "", tipo: "" }), 4000);
      } else { 
        setErroDetalhe(data.message || "Não foi possível guardar o funcionário."); 
      } 
    } catch (err) { 
      console.error("Erro ao guardar funcionário:", err); 
      setErroDetalhe(err.message || "Erro de ligação ao servidor."); 
    } finally { 
      setSalvando(false); 
    } 
  }; 

  return ( 
    <div className="escolas-container"> 
      <header className="top-bar header-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}> 
        <div className='top-info'> 
          <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f172a' }}>Gestão Institucional de Pessoal</h1> 
          <p style={{ fontSize: '13px', color: '#64748b' }}>{escolaAtual?.nome ? `${escolaAtual.sigla} — ${escolaAtual.nome}` : 'Unidade Escolar'}</p> 
        </div> 
        <div className="top-ano" style={{ display: 'flex', gap: '10px' }}> 
          <button onClick={abrirModalCriar} disabled={!escolaIdLogada} className="ce-btn-submit" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: escolaIdLogada ? 'pointer' : 'not-allowed' }}> 
            <BsPlusLg size={16} /> Adicionar Novo Funcionário 
          </button> 
        </div> 
      </header> 

      {mensagem.texto && ( 
        <div style={{ margin: '0 0 20px 0', padding: '12px 16px', borderRadius: '8px', background: mensagem.tipo === 'sucesso' ? '#dcfce7' : '#fee2e2', color: mensagem.tipo === 'sucesso' ? '#166534' : '#991b1b', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 'bold' }}> 
          {mensagem.tipo === 'sucesso' ? <BsCheckCircle /> : <BsExclamationTriangle />} 
          <span>{mensagem.texto}</span> 
          <button type="button" onClick={() => setMensagem({ texto: "", tipo: "" })} aria-label="Fechar mensagem" style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '16px' }}>×</button>
        </div> 
      )} 

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px' }}> 
        {/* BARRA LATERAL: UNIDADES DE POLOS */} 
        <aside style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '16px', height: 'fit-content' }}> 
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Unidades de Polos</h3> 
            <button onClick={() => { setErroDetalhe(""); setIsPoloModalOpen(true); }} disabled={!escolaIdLogada} style={{ background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', fontWeight: 'bold', cursor: escolaIdLogada ? 'pointer' : 'not-allowed' }}>+ Novo Polo</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', marginBottom: '12px' }}> 
            <BsSearch color="#64748b" style={{ marginRight: '8px' }} /> 
            <input type="text" placeholder="Pesquisar polo..." value={searchPolo} onChange={(e) => setSearchPolo(e.target.value)} style={{ width: '100%', border: 'none', background: 'transparent', padding: '8px 0', fontSize: '13px', outline: 'none' }} /> 
          </div> 

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '55vh', overflowY: 'auto' }}> 
            <div onClick={() => setPoloSelecionado(null)} style={{ padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', background: poloSelecionado === null ? '#e0f2fe' : '#f8fafc', border: poloSelecionado === null ? '1px solid #0284c7' : '1px solid #e2e8f0', fontSize: '13px', fontWeight: 'bold', color: '#0f172a' }}>
              🌐 Todos / Visão Geral (Sede & Polos)
            </div>

            {loading ? ( 
              <p style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>A carregar polos...</p> 
            ) : polosFiltrados.length > 0 ? ( 
              polosFiltrados.map((polo) => ( 
                <div key={polo.id} onClick={() => setPoloSelecionado(polo.id)} style={{ padding: '12px', borderRadius: '10px', cursor: 'pointer', background: poloSelecionado === polo.id ? '#e0f2fe' : '#f8fafc', border: poloSelecionado === polo.id ? '1px solid #0284c7' : '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '10px' }} > 
                  <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: '#0284c7', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '11px', flexShrink: 0 }}> 
                    {polo.codigo || 'POLO'} 
                  </div> 
                  <div style={{ overflow: 'hidden' }}> 
                    <strong style={{ display: 'block', fontSize: '13px', color: '#0f172a', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{polo.nome}</strong> 
                    <span style={{ fontSize: '11px', color: '#64748b' }}><BsGeoAlt size={10} /> {polo.local || 'Sede'}</span> 
                  </div> 
                </div> 
              )) 
            ) : ( 
              <div style={{ padding: '15px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                <p>Nenhum polo registado.</p>
                <button onClick={() => { setErroDetalhe(""); setIsPoloModalOpen(true); }} disabled={!escolaIdLogada} style={{ marginTop: '8px', color: '#0284c7', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold' }}>Criar primeiro polo</button>
              </div>
            )} 
          </div> 
        </aside> 

        {/* PAINEL PRINCIPAL: LISTAGEM E FILTROS */} 
        <main className="escolas-table-card"> 
          <div className="table-top-bar" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}> 
            <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
              <div> 
                <h2 style={{ fontSize: '16px', color: '#0f172a' }}>Equipa Institucional</h2> 
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                  {poloSelecionado === null ? 'A mostrar todos os funcionários (Incluindo Centrais e Polos)' : `A mostrar funcionários do polo selecionado`}
                </p> 
              </div>
              {/* Barra de pesquisa de funcionários */}
              <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', width: '260px' }}> 
                <BsSearch color="#64748b" style={{ marginRight: '8px' }} /> 
                <input type="text" placeholder="Pesquisar por nome ou login..." value={searchFuncionario} onChange={(e) => setSearchFuncionario(e.target.value)} style={{ width: '100%', border: 'none', background: 'transparent', padding: '6px 0', fontSize: '12px', outline: 'none' }} /> 
              </div>
            </div> 

            {/* Abas de Cargos (Secretaria, Professores, Tesouraria) */} 
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', width: '100%', paddingBottom: '8px' }}> 
              <button onClick={() => setAbaAtiva("secretaria")} style={{ background: abaAtiva === 'secretaria' ? '#0284c7' : '#f1f5f9', color: abaAtiva === 'secretaria' ? '#fff' : '#475569', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}> Secretaria </button> 
              <button onClick={() => setAbaAtiva("professor")} style={{ background: abaAtiva === 'professor' ? '#0284c7' : '#f1f5f9', color: abaAtiva === 'professor' ? '#fff' : '#475569', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}> Professores </button> 
              <button onClick={() => setAbaAtiva("tesouraria")} style={{ background: abaAtiva === 'tesouraria' ? '#0284c7' : '#f1f5f9', color: abaAtiva === 'tesouraria' ? '#fff' : '#475569', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}> Tesouraria </button> 
            </div> 
          </div> 

          {loadingFuncionarios ? ( 
            <p style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>A carregar colaboradores...</p> 
          ) : funcionariosFiltrados.length > 0 ? ( 
            <div className='escolas-table'> 
              <table className="escolas-custom-table"> 
                <thead> 
                  <tr> 
                    <th>Nome Completo</th> 
                    <th>Cargo / Polo</th> 
                    <th>Contactos</th> 
                    <th>Login ID (Acesso)</th> 
                    <th>Estado</th> 
                    <th style={{ textAlign: 'right' }}>Ações</th> 
                  </tr> 
                </thead> 
                <tbody> 
                  {funcionariosFiltrados.map((user) => ( 
                    <tr key={user.id}> 
                      <td style={{ fontWeight: 600, color: '#0f172a' }}>{user.nome}</td> 
                      <td> 
                        <span className="counter-pill" style={{ textTransform: 'uppercase' }}> {user.papel} </span>
                        <div style={{ fontSize: '11px', color: user.polo_nome ? '#0284c7' : '#10b981', marginTop: '2px' }}>
                          {user.polo_nome ? `Polo: ${user.polo_nome}` : '⭐ Central / Geral'}
                        </div>
                      </td> 
                      <td style={{ fontSize: '12px', color: '#64748b' }}> 
                        <span><BsEnvelope size={11} /> {user.email}</span><br /> 
                        <span><BsTelephone size={11} /> {user.telefone || 'N/D'}</span> 
                      </td> 
                      <td><code>{user.login_id}</code></td> 
                      <td> 
                        <span className={`badge-status-pill ${user.status_ativo ? 'ativo' : 'desativado'}`}> {user.status_ativo ? 'Ativo' : 'Inativo'} </span> 
                      </td> 
                      <td style={{ textAlign: 'right' }}> 
                        <div className="action-buttons-group"> 
                          <button className="btn-tb-act edit" onClick={() => abrirModalEditar(user)}> <BsPencilSquare /> Editar </button> 
                        </div> 
                      </td> 
                    </tr> 
                  ))} 
                </tbody> 
              </table> 
            </div> 
          ) : ( 
            <p style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Nenhum funcionário encontrado nesta categoria ou polo.</p> 
          )} 
        </main> 
      </div> 

      {/* MODAL CRIAR POLO */}
      {isPoloModalOpen && (
        <div className="modal-admin-overlay" onClick={() => setIsPoloModalOpen(false)}> 
          <div className="modal-admin-box" style={{ maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}> 
            <div className="modal-admin-header"> 
              <h2>Criar Novo Polo</h2> 
              <button type="button" className="btn-modal-close" onClick={() => setIsPoloModalOpen(false)}>✕</button> 
            </div> 
            <form onSubmit={handleCriarPolo} className="modal-admin-body" style={{ padding: '20px' }}> 
              {erroDetalhe && (
                <div role="alert" style={{ marginBottom: '16px', padding: '12px', borderRadius: '8px', background: '#fee2e2', color: '#991b1b', fontSize: '13px' }}>
                  {erroDetalhe}
                </div>
              )}
              <div className="ce-field-group"> 
                <label>Nome do Polo *</label> 
                <input type="text" required maxLength={120} value={formPolo.nome} onChange={(e) => setFormPolo({ ...formPolo, nome: e.target.value })} className="ce-input" placeholder="Ex: Ramo Liceu / Jardim de Infância" /> 
              </div> 
              <div className="ce-field-group"> 
                <label>Código do Polo *</label> 
                <input type="text" required maxLength={30} value={formPolo.codigo} onChange={(e) => setFormPolo({ ...formPolo, codigo: e.target.value.toUpperCase() })} className="ce-input" placeholder="Ex: SEDE, LICEU-01" /> 
              </div> 
              <div className="ce-field-group"> 
              <label>Endereço completo</label> 
                <input type="text" maxLength={255} value={formPolo.endereco} onChange={(e) => setFormPolo({ ...formPolo, endereco: e.target.value })} className="ce-input" placeholder="Rua, número, bairro" /> 
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="ce-field-group">
                  <label>Localidade / Sector</label>
                  <input type="text" maxLength={120} value={formPolo.local} onChange={(e) => setFormPolo({ ...formPolo, local: e.target.value })} className="ce-input" placeholder="Cidade, região ou sector" />
                </div>
                <div className="ce-field-group">
                  <label>Telefone do Polo</label>
                  <GuineaBissauPhoneInput maxLength={40} value={formPolo.telefone} onChange={(value) => setFormPolo((current) => ({ ...current, telefone: value }))} className="ce-input" placeholder="+245 ..." />
                </div>
              </div> 
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}> 
                <button type="button" onClick={() => setIsPoloModalOpen(false)} className="ce-btn-back" disabled={salvando}>Cancelar</button> 
                <button type="submit" className="ce-btn-submit" disabled={salvando || !escolaIdLogada}>{salvando ? "A criar..." : "Criar Polo"}</button> 
              </div> 
            </form> 
          </div> 
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE FUNCIONÁRIO */} 
      {isModalOpen && ( 
        <div className="modal-admin-overlay" onClick={() => setIsModalOpen(false)}> 
          <div className="modal-admin-box" style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}> 
            <div className="modal-admin-header"> 
              <h2>{editMode ? "Editar Funcionário" : "Registar Novo Funcionário"}</h2> 
              <button className="btn-modal-close" onClick={() => setIsModalOpen(false)}>✕</button> 
            </div> 
            <form onSubmit={handleSalvarRegisto} className="modal-admin-body" style={{ padding: '24px' }}> 
              {erroDetalhe && ( 
                <div role="alert" style={{ marginBottom: '16px', padding: '12px', borderRadius: '8px', background: '#fee2e2', color: '#991b1b', fontSize: '13px' }}> 
                  {erroDetalhe} 
                </div> 
              )} 

              <div className="ce-field-group"> 
                <label>Nome Completo *</label> 
                <input type="text" required value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} className="ce-input" placeholder="Ex: Carlos Alberto Mendes" /> 
              </div> 

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="ce-field-group"> 
                  <label>Email Institucional</label> 
                  <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="ce-input" placeholder="carlos@escola.gw" /> 
                </div> 
                <div className="ce-field-group"> 
                  <label>Contacto Telefónico *</label> 
                  <GuineaBissauPhoneInput required value={formData.telefone} onChange={(value) => setFormData((current) => ({ ...current, telefone: value }))} className="ce-input" placeholder="+245 95XXXXXX" />
                </div> 
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="ce-field-group"> 
                  <label>Cargo / Papel Institucional *</label> 
                  <select value={formData.papel} onChange={(e) => setFormData({ ...formData, papel: e.target.value })} className="ce-select" disabled={editMode}> 
                    <option value="secretaria">Secretaria</option> 
                    <option value="professor">Professor</option> 
                    <option value="tesouraria">Tesouraria</option> 
                  </select>
                  {editMode && <small style={{ color: '#64748b' }}>O backend não permite alterar o cargo durante a edição.</small>}
                </div> 
                <div className="ce-field-group"> 
                  <label>Atribuição de Polo / Nível</label> 
                  <select value={formData.polo_id} onChange={(e) => setFormData({ ...formData, polo_id: e.target.value })} className="ce-select" > 
                    <option value="">⭐ Central / Geral (Aparece em todos)</option>
                    {polos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome} ({p.codigo})</option>
                    ))}
                  </select> 
                </div> 
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="ce-field-group">
                  <label>Género</label>
                  <select value={formData.genero} onChange={(e) => setFormData({ ...formData, genero: e.target.value })} className="ce-select">
                    <option value="Masculino">Masculino</option>
                    <option value="Feminino">Feminino</option>
                  </select>
                </div>
                <div className="ce-field-group">
                  <label>BI / Passaporte</label>
                  <input type="text" value={formData.bi_ou_passaporte} onChange={(e) => setFormData({ ...formData, bi_ou_passaporte: e.target.value })} className="ce-input" />
                </div>
              </div>
              <div className="ce-field-group">
                <label>Morada</label>
                <input type="text" value={formData.morada} onChange={(e) => setFormData({ ...formData, morada: e.target.value })} className="ce-input" placeholder="Bairro, sector ou cidade" />
              </div>

              {formData.papel === 'professor' && (
                <div style={{ marginTop: '16px', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 'bold', color: '#0284c7', marginBottom: '12px' }}>Detalhes Pedagógicos do Professor</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div className="ce-field-group">
                      <label>Habilitação Literária</label>
                      <input type="text" value={formData.habilitacao_literaria} onChange={(e) => setFormData({ ...formData, habilitacao_literaria: e.target.value })} className="ce-input" placeholder="Ex: Licenciatura" />
                    </div>
                    <div className="ce-field-group">
                      <label>Especialidade</label>
                      <input type="text" value={formData.specialidade} onChange={(e) => setFormData({ ...formData, specialidade: e.target.value })} className="ce-input" placeholder="Ex: Matemática" />
                    </div>
                    <div className="ce-field-group">
                      <label>Regime de Trabalho</label>
                      <input type="text" value={formData.regime_trabalho} onChange={(e) => setFormData({ ...formData, regime_trabalho: e.target.value })} className="ce-input" placeholder="Integral / Parcial" />
                    </div>
                    <div className="ce-field-group">
                      <label>Grau Académico</label>
                      <input type="text" value={formData.grau_academico} onChange={(e) => setFormData({ ...formData, grau_academico: e.target.value })} className="ce-input" placeholder="Licenciatura, Mestrado..." />
                    </div>
                    <div className="ce-field-group">
                      <label>Anos de Experiência</label>
                      <input type="number" min="0" step="1" value={formData.anos_experiencia} onChange={(e) => setFormData({ ...formData, anos_experiencia: e.target.value })} className="ce-input" />
                    </div>
                    <div className="ce-field-group" style={{ gridColumn: '1 / -1' }}>
                      <label>Observações</label>
                      <textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="ce-input" rows={3} />
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}> 
                <button type="button" onClick={() => setIsModalOpen(false)} className="ce-btn-back" disabled={salvando}>Cancelar</button> 
                <button type="submit" className="ce-btn-submit" disabled={salvando}> {salvando ? "A guardar..." : editMode ? "Guardar Alterações" : "Criar e Gerar Acesso"} </button> 
              </div> 
            </form> 
          </div> 
        </div> 
      )} 
    </div> 
  ); 
}