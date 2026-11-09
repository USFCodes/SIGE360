'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import NextImage from 'next/image';
import { BsSearch, BsEye, BsPencilSquare, BsPrinter, BsArrowLeft, BsArrowRight, BsCheckCircleFill, BsExclamationTriangleFill, BsCheck2Circle } from 'react-icons/bs';
import { GUINE_REGIOES, TIPOS_GESTAO } from '../../../../utils/constantes';
import GuineaBissauPhoneInput from '@/components/GuineaBissauPhoneInput';
import AdminHeader from '@/components/adminHeader';
import '../../../../styles/a4.css';

const API_URL = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/accounts`;

async function carregarLogo(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) { throw new Error('Selecione uma imagem JPEG, PNG ou WebP.');}
  const formData = new FormData();
  formData.append('logo', file);

  const response = await fetch(`${API_URL}/escolas/logo`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true || typeof data.data?.logo_url !== 'string') {
    throw new Error(data.message || `Não foi possível preparar o logótipo (HTTP ${response.status}).`);
  }
  return data.data.logo_url;
}

const FORM_DATA_INICIAL = {
  nome_escola: "", diretor_nome: "", diretor_contacto: "", diretor_email: "", sigla: "",
  categoria: "", niveis_ids: [], local: "SAB", bairro: "", endereco: "", regime_periodo: "Regular",
  nif: "", licenca_men: "", aceitou_termos: false, subdominio: "", logo_url: "", cor_primaria: "#0284c7",
  motto: "", visao: "", missao: "", valor: ""
};

function contarPalavras(texto) {
  return texto.trim() ? texto.trim().split(/\s+/).length : 0;
}

export default function GodEscolas() {
  const [escolas, setEscolas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [escolasErro, setEscolasErro] = useState("");
  const [newEscolaModal, createNewModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLocal, setFilterLocal] = useState('Todos');
  const [filterNivel, setFilterNivel] = useState('Todos');
  const [filterStatus, setFilterStatus] = useState('Todos');
  const [niveisEnsino, setNiveisEnsino] = useState([]);
  const [loadingNiveis, setLoadingNiveis] = useState(true);
  const [niveisErro, setNiveisErro] = useState("");
  const [paginaAtual, setPaginaAtual] = useState(1);

  const [selectedEscolaView, setSelectedEscolaView] = useState(null);
  const [selectedEscolaEdit, setSelectedEscolaEdit] = useState(null);

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [feedback, setFeedback] = useState({ text: "", type: "" });
  const [direcaoGerada, setDirecaoGerada] = useState(null);
  const [formData, setFormData] = useState(FORM_DATA_INICIAL);

  const localidadesDisponiveis = GUINE_REGIOES[formData.local]?.locales || [];
  const escolasFiltradas = useMemo(() => {
    let lista = escolas;
    if (searchTerm) {
      const termo = searchTerm.toLowerCase();
      lista = lista.filter((escola) =>
        (escola.nome || '').toLowerCase().includes(termo) ||
        (escola.sigla || '').toLowerCase().includes(termo) ||
        (escola.nif || '').toLowerCase().includes(termo) ||
        (escola.subdominio || '').toLowerCase().includes(termo)
      );
    }
    if (filterNivel !== 'Todos') {
      lista = lista.filter((escola) =>
        escola.niveis_ids.some((id) => String(id) === String(filterNivel))
      );
    }
    if (filterLocal !== 'Todos') {
      lista = lista.filter((escola) => escola.local === filterLocal);
    }
    if (filterStatus === 'Ativo') {
      lista = lista.filter((escola) => escola.status_verificacao === 'ativo' || escola.status_verificacao === 'verified');
    }
    if (filterStatus === 'Desativado') {
      lista = lista.filter((escola) => escola.status_verificacao === 'inativo' || escola.status_verificacao === 'desativado');
    }
    return lista;
  }, [escolas, filterLocal, filterNivel, filterStatus, searchTerm]);
  const totalRegistos = escolasFiltradas.length;
  const totalPaginas = Math.max(1, Math.ceil(totalRegistos / 10));
  const escolasVisiveis = escolasFiltradas.slice((paginaAtual - 1) * 10, paginaAtual * 10);

  const getNivelTexto = (nivelIdVal) => {
    const ids = Array.isArray(nivelIdVal) ? nivelIdVal : [nivelIdVal];
    return ids
      .map((id) => niveisEnsino.find((nivel) => String(nivel.id) === String(id))?.nome)
      .filter(Boolean)
      .join(', ') || 'Níveis não informados';
  };

  useEffect(() => {
    let mounted = true;

    async function carregarNiveisEnsino() {
      try {
        const response = await fetch(`${API_URL}/niveis-ensino`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store'
        });
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.data)) {
          throw new Error(data.message || 'Não foi possível carregar os níveis de ensino.');
        }
        if (mounted) {
          setNiveisEnsino(data.data.filter((nivel) => nivel.id != null && nivel.nome));
          setNiveisErro("");
        }
      } catch (error) {
        if (mounted) {
          setNiveisErro(error.message || 'Não foi possível carregar os níveis de ensino.');
        }
      } finally {
        if (mounted) setLoadingNiveis(false);
      }
    }

    carregarNiveisEnsino();
    return () => {
      mounted = false;
    };
  }, []);

  const buscarEscolas = useCallback(async () => {
    const response = await fetch(`${API_URL}/escolas`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok || !data.success || !Array.isArray(data.data)) {
      throw new Error(data.message || 'Não foi possível listar as escolas.');
    }
    return data.data.map((escola) => ({
      ...escola,
      id_raw: escola.id,
      id: escola.sigla || escola.id,
      sigla: escola.sigla || (escola.nome || '').substring(0, 3).toUpperCase(),
      sector: escola.sector || escola.morada || '',
      licencaMen: escola.licenca_men || '',
      responsavel: escola.diretor_nome || escola.responsavel || escola.nome_responsavel || '',
      contacto: escola.diretor_contacto || escola.contacto || escola.contacto_responsavel || '',
      totalAlunos: escola.total_alunos || 0,
      status: escola.status_verificacao === 'ativo' || escola.status_verificacao === 'verified' ? 'Ativo' : 'Desativado',
      niveis_ids: Array.isArray(escola.niveis_ids) ? escola.niveis_ids : [],
      corPrimaria: escola.cor_primaria || '#0284c7',
      endereco: escola.morada || escola.endereco || ''
    }));
  }, []);

  useEffect(() => {
    let mounted = true;
    buscarEscolas()
      .then((lista) => {
        if (mounted) {
          setEscolas(lista);
          setEscolasErro("");
        }
      })
      .catch((error) => {
        if (mounted) {
          console.error('Erro de conexão com o servidor:', error);
          setEscolasErro(error.message || 'Não foi possível listar as escolas.');
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [buscarEscolas]);

  const atualizarEscolas = async () => {
    try {
      setEscolas(await buscarEscolas());
      setEscolasErro("");
    } catch (error) {
      console.error('Erro ao atualizar a lista de escolas:', error);
      setEscolasErro(error.message || 'Não foi possível atualizar a lista de escolas.');
    }
  };

  const calcularSiglaESubdominio = (nome) => {
    if (!nome) return { sigla: "", subdominio: "" };
    const ignoreWords = ["de", "da", "do", "dos", "das", "e", "a", "o", "escola", "liceu", "colegio", "colégio"];
    const words = nome.trim().split(/\s+/).filter((w) => !ignoreWords.includes(w.toLowerCase()));
    let siglaGerada = "ESC";
    if (words.length === 1) {
      siglaGerada = words[0].substring(0, 4).toUpperCase();
    } else if (words.length > 1) {
      siglaGerada = words.map((w) => w[0]).join("").toUpperCase().substring(0, 6);
    }
    const subdominioGerado = nome.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 15);
    return { sigla: siglaGerada, subdominio: subdominioGerado };
  };

  const handleChange = (e) => {
    const { id, name, value, type, checked } = e.target;
    const fieldId = id || name;
    let val = type === "checkbox" ? checked : value;
    if (fieldId === "visao" && contarPalavras(value) > 500) {
      showFeedback("A visão da escola não pode ultrapassar 500 palavras.");
      return;
    }

    setFormData((prev) => {
      const updated = { ...prev, [fieldId]: val };
      if (fieldId === "nome_escola") {
        const { sigla, subdominio } = calcularSiglaESubdominio(val);
        updated.sigla = sigla;
        updated.subdominio = subdominio;
      }
      if (fieldId === "local") updated.bairro = "";
      return updated;
    });
  };

  const handlePhotoChange = async (e, destination) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessingPhoto(true);
    try {
      const photoUrl = await carregarLogo(file);
      if (destination === 'create') {
        setFormData((prev) => ({ ...prev, logo_url: photoUrl }));
      } else {
        setSelectedEscolaEdit((prev) => ({ ...prev, logo_url: photoUrl, remover_logo: false }));
      }
      showFeedback('Logótipo preparado e pronto para guardar.', 'success');
    } catch (error) {
      showFeedback(error.message || 'Não foi possível processar a foto.');
    } finally {
      setProcessingPhoto(false);
      e.target.value = '';
    }
  };

  const toggleNivelEnsino = (nivelId) => {
    const selectedId = String(nivelId);
    setFormData((prev) => {
      const novosNiveis = prev.niveis_ids.includes(selectedId)
        ? prev.niveis_ids.filter((id) => id !== selectedId)
        : [...prev.niveis_ids, selectedId];
      return {
        ...prev,
        niveis_ids: novosNiveis
      };
    });
  };

  const showFeedback = (text, type = "error", duration = 3000) => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback({ text: "", type: "" }), duration);
  };

  const handleNext = (e) => {
    e.preventDefault();
    if (processingPhoto) return showFeedback("Aguarde a compressão da foto.");
    if (step === 1 && (!formData.nome_escola.trim() || !formData.sigla.trim())) {
      return showFeedback("Preencha o nome completo e a sigla da escola.");
    }
    if (step === 1 && formData.sigla.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').length < 2) {
      return showFeedback("A sigla deve conter pelo menos duas letras para gerar o login.");
    }
    if (step === 1 && !formData.categoria) {
      return showFeedback("Selecione o tipo de gestão da escola.");
    }
    if (step === 1 && loadingNiveis) return showFeedback("Aguarde o carregamento dos níveis de ensino.");
    if (step === 1 && niveisErro) {
      return showFeedback(niveisErro);
    }
    if (step === 1 && niveisEnsino.length === 0) {
      return showFeedback("Não existem níveis de ensino configurados.");
    }
    if (step === 1 && formData.diretor_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.diretor_email)) {
      return showFeedback("Introduza um email válido para o diretor.");
    }
    setStep((prev) => prev + 1);
  };

  const handleBack = () => setStep((prev) => prev - 1);

  const handleSubmitFinal = async () => {
    if (!formData.aceitou_termos) {
      return showFeedback("É obrigatório aceitar os termos de utilização.");
    }
    setSubmitting(true);
    setFeedback({ text: "", type: "" });
    try {
      const payload = {
        nome_escola: formData.nome_escola.trim(),
        sigla: formData.sigla.trim(),
        categoria: Number(formData.categoria),
        niveis_ids: formData.niveis_ids,
        local: formData.local,
        sector: formData.bairro || null,
        endereco: formData.endereco.trim() || null,
        regime_periodo: formData.regime_periodo.trim() || null,
        nif: formData.nif.trim() || null,
        licenca_men: formData.licenca_men.trim() || null,
        aceitou_termos: formData.aceitou_termos,
        subdominio: formData.subdominio || null,
        logo_url: formData.logo_url.trim() || null,
        cor_primaria: formData.cor_primaria,
        motto: formData.motto.trim() || null,
        visao: formData.visao.trim() || null,
        missao: formData.missao.trim() || null,
        valor: formData.valor.trim() || null,
        diretor_nome: formData.diretor_nome.trim() || null,
        diretor_contacto: formData.diretor_contacto.trim() || null,
        diretor_email: formData.diretor_email.trim() || null
      };

      const response = await fetch(`${API_URL}/escolas`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Erro ao registar a escola.");
      }

      setDirecaoGerada(data.data?.direcao_gerada || null);
      showFeedback("Escola e conta da Direção criadas com sucesso.", "success");
      await atualizarEscolas();
    } catch (err) {
      showFeedback(err.message || "Erro ao registar a escola.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const abrirModalNovaEscola = () => {
    setFormData({ ...FORM_DATA_INICIAL });
    setDirecaoGerada(null);
    setFeedback({ text: "", type: "" });
    setStep(1);
    createNewModal(true);
  };

  const fecharModalNovaEscola = () => {
    createNewModal(false);
    setDirecaoGerada(null);
    setFeedback({ text: "", type: "" });
  };

  const handleAbrirVisualizacao = async (escolaResumo) => {
    try {
      const response = await fetch(`${API_URL}/escolas/${escolaResumo.id_raw}`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (data.success) {
        setSelectedEscolaView(data.data);
      } else {
        showFeedback(data.message || "Erro ao carregar detalhes da escola.");
      }
    } catch (error) {
      showFeedback("Erro de conexão ao carregar detalhes.");
    }
  };

  const handleAbrirEdicao = async (escolaResumo) => {
    try {
      const response = await fetch(`${API_URL}/escolas/${escolaResumo.id_raw}`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (data.success) {
        const e = data.data;
        setSelectedEscolaEdit({
          id_raw: e.id,
          nome: e.nome,
          sigla: e.sigla,
          nif: e.nif,
          descricao: e.descricao || '',
          morada: e.morada || '',
          endereco: e.endereco || '',
          contacto: e.contacto || '',
          email: e.email || '',
          logo_url: e.logo_url || '',
          remover_logo: false,
          categoria: e.categoria ?? '',
          local: e.local || '',
          sector: e.sector || '',
          subdominio: e.subdominio || '',
          licenca_men: e.licenca_men || '',
          regime_periodo: e.regime_periodo || '',
          cor_primaria: e.cor_primaria || '#0284c7',
          motto: e.motto || '',
          visao: e.visao || '',
          missao: e.missao || '',
          valor: e.valor || '',
          diretor_nome: e.diretor_nome || '',
          diretor_contacto: e.diretor_contacto || '',
          diretor_email: e.diretor_email || '',
          niveis_ids: Array.isArray(e.niveis_ids) ? e.niveis_ids : [],
          status: (e.status_verificacao === 'ativo' || e.status_verificacao === 'verified') ? 'Ativo' : 'Desativado',
        });
      } else {
        showFeedback(data.message || "Erro ao carregar dados para edição.");
      }
    } catch (error) {
      showFeedback("Erro de conexão ao carregar dados.");
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (processingPhoto) return showFeedback('Aguarde o processamento do logótipo.');
    if (contarPalavras(selectedEscolaEdit.visao || '') > 500) {
      return showFeedback('A visão da escola não pode ultrapassar 500 palavras.');
    }
    const subdominio = (selectedEscolaEdit.subdominio || '').trim().toLowerCase();
    if (subdominio && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdominio)) {
      return showFeedback('O subdomínio deve ter 1 a 63 caracteres: letras minúsculas, números e hífen, sem hífen no início ou no fim.');
    }
    try {
      const rawId = selectedEscolaEdit.id_raw;
      const response = await fetch(`${API_URL}/escolas/${rawId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: selectedEscolaEdit.nome,
          sigla: selectedEscolaEdit.sigla,
          descricao: selectedEscolaEdit.descricao,
          morada: selectedEscolaEdit.morada,
          endereco: selectedEscolaEdit.endereco,
          contacto: selectedEscolaEdit.contacto,
          email: selectedEscolaEdit.email,
          nif: selectedEscolaEdit.nif,
          logo_url: selectedEscolaEdit.logo_url,
          remover_logo: selectedEscolaEdit.remover_logo,
          categoria: selectedEscolaEdit.categoria,
          local: selectedEscolaEdit.local,
          sector: selectedEscolaEdit.sector,
          subdominio: subdominio || null,
          licenca_men: selectedEscolaEdit.licenca_men,
          regime_periodo: selectedEscolaEdit.regime_periodo,
          cor_primaria: selectedEscolaEdit.cor_primaria,
          motto: selectedEscolaEdit.motto,
          visao: selectedEscolaEdit.visao,
          missao: selectedEscolaEdit.missao,
          valor: selectedEscolaEdit.valor,
          diretor_nome: selectedEscolaEdit.diretor_nome,
          diretor_contacto: selectedEscolaEdit.diretor_contacto,
          diretor_email: selectedEscolaEdit.diretor_email,
          niveis_ids: selectedEscolaEdit.niveis_ids,
          status_verificacao: selectedEscolaEdit.status === 'Ativo' ? 'ativo' : 'inativo',
        })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        alert('Informações atualizadas com sucesso!');
        setSelectedEscolaEdit(null);
        await atualizarEscolas();
      } else {
        alert('Erro ao atualizar: ' + (data.message || 'Não foi possível atualizar a escola.'));
      }
    } catch (error) {
      alert('Erro interno ao comunicar com o servidor.');
    }
  };

  return (
    <>
      <div className="owner-schools-sticky-tools">
        <AdminHeader titulo='Registo Geral de Escolas' descricao='Módulo de Controlo Institucional e Monitorização Global do Sistema' sumItem={abrirModalNovaEscola} sumItemText='Criar Escola'/>

        <section className="escolas-filter-card">
          <div className="filter-search-row">
            <div className="escolas-search-input-wrapper">
              <BsSearch className="escolas-search-icon" /> 
              <input type="text" placeholder="Pesquisar por Nome da Escola, Sigla, NIF ou Subdomínio..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setPaginaAtual(1); }} />
            </div>
            <button className="btn-clear-filters" onClick={() => { setSearchTerm(''); setFilterLocal('Todos'); setFilterNivel('Todos'); setFilterStatus('Todos'); setPaginaAtual(1); }}>
              Limpar Filtros
            </button>
          </div>

          <div className="filter-selects-row">
            <div className="filter-select-group">
              <label>REGIÃO / LOCALIDADE</label>
              <select value={filterLocal} onChange={(e) => { setFilterLocal(e.target.value); setPaginaAtual(1); }}>
                <option value="Todos">Todas as Regiões</option>
                {Object.keys(GUINE_REGIOES).map((regKey) => (
                  <option key={regKey} value={regKey}>{GUINE_REGIOES[regKey].nome}</option>
                ))}
              </select>
            </div>

            <div className="filter-select-group">
              <label>NÍVEL DE ENSINO</label>
              <select value={filterNivel} onChange={(e) => { setFilterNivel(e.target.value); setPaginaAtual(1); }}>
                <option value="Todos">Todos os Níveis</option>
                {niveisEnsino.map((nivel) => (
                  <option key={nivel.id} value={nivel.id}>{nivel.nome}</option>
                ))}
              </select>
            </div>

            <div className="filter-select-group">
              <label>ESTADO DA ESCOLA</label>
              <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPaginaAtual(1); }}>
                <option value="Todos">Todos os Estados</option>
                <option value="Ativo">Ativo</option>
                <option value="Desativado">Desativado</option>
              </select>
            </div>
          </div>
        </section>
      </div>

      <main className="escolas-table-card">
        <div className="table-top-bar">
          <h2>LISTAGEM DE UNIDADES ESCOLARES</h2>
          <span className="counter-pill">TOTAL: {totalRegistos} ESCOLAS</span>
        </div>
        <div className='escolas-table'>
          <table className="escolas-custom-table">
            <thead>
              <tr>
                <th>ESCOLA / SIGLA</th>
                <th>ID / NIF</th>
                <th>LICENÇA / NÍVEL</th>
                <th>RESPONSÁVEL / CONTACTO</th>
                <th>ALUNOS</th>
                <th>ESTADO</th>
                <th style={{ textAlign: 'right' }}>AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>A carregar dados...</td></tr>
              ) : escolasErro && escolas.length === 0 ? (
                <tr><td colSpan="7" role="alert" style={{ textAlign: 'center', padding: '40px', color: '#dc2626' }}>{escolasErro}</td></tr>
              ) : escolas.length > 0 ? (
                escolasVisiveis.map((escola) => (
                  <tr key={escola.id_raw}>
                    <td>
                      <div className="escola-info-cell">
                        <div className="escola-avatar-icon" style={{ background: escola.corPrimaria || '#0284c7' }}>
                          {escola.sigla}
                        </div>
                        <div>
                          <strong>{escola.nome}</strong>
                          <span>{escola.local} · {escola.sector}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="cell-details">
                        <strong>{escola.id}</strong>
                        <span>NIF: {escola.nif}</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-details">
                        <strong>{escola.licencaMen}</strong>
                        <span>{getNivelTexto(escola.niveis_ids)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-details">
                        <strong>{escola.responsavel}</strong>
                        <span>{escola.contacto}</span>
                      </div>
                    </td>
                    <td><span className="counter-pill">{escola.totalAlunos}</span></td>
                    <td><span className={`badge-status-pill ${escola.status.toLowerCase()}`}>{escola.status}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="action-buttons-group">
                        <button className="btn-tb-act view" onClick={() => handleAbrirVisualizacao(escola)}><BsEye /> Ver</button>
                        <button className="btn-tb-act edit" onClick={() => handleAbrirEdicao(escola)}><BsPencilSquare /> Editar</button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>Nenhuma escola encontrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPaginas > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', padding: '20px 0' }}>
            <button disabled={paginaAtual === 1} onClick={() => setPaginaAtual(p => Math.max(p - 1, 1))} className="ce-btn-back">Anterior</button>
            <span style={{ alignSelf: 'center', fontSize: '12px', fontWeight: 'bold' }}>Página {paginaAtual} de {totalPaginas}</span>
            <button disabled={paginaAtual === totalPaginas} onClick={() => setPaginaAtual(p => Math.min(p + 1, totalPaginas))} className="ce-btn-back">Seguinte</button>
          </div>
        )}
      </main>

      {/* MODAL: CRIAR NOVA ESCOLA MULTI-NÍVEL */}
      {newEscolaModal && (
        <div className="modal-admin-overlay">
          <div className="modal-admin-box ce-modal-card-large" onClick={(e) => e.stopPropagation()}>
            <div className="ce-header-hero modal-admin-header">
              <div className="ce-header-info">
                <h2>REGISTO DE NOVA ESCOLA MULTI-NÍVEL</h2>
                <p>Passo {step} de 4 · Dados da escola, níveis de ensino e direção</p>
              </div>
              <button className="btn-modal-close" onClick={fecharModalNovaEscola}>✕</button>
            </div>

            {feedback.text && (
              <div className={`ce-banner ${feedback.type}`} style={{ margin: '15px 20px 0 20px' }}>
                {feedback.type === 'success' ? <BsCheckCircleFill /> : <BsExclamationTriangleFill />}
                <span>{feedback.text}</span>
              </div>
            )}

            <div className="ce-stepper-bar" style={{ margin: '15px 20px' }}>
              <div className={`ce-step-item ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
                <div className="ce-step-num">{step > 1 ? '✓' : '1'}</div>
                <div className="ce-step-text"><span>PASSO 01</span><strong>Identidade</strong></div>
              </div>
              <div className={`ce-step-item ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`}>
                <div className="ce-step-num">{step > 2 ? '✓' : '2'}</div>
                <div className="ce-step-text"><span>PASSO 02</span><strong>Legal & Morada</strong></div>
              </div>
              <div className={`ce-step-item ${step === 3 ? 'active' : step > 3 ? 'completed' : ''}`}>
                <div className="ce-step-num">{step > 3 ? '✓' : '3'}</div>
                <div className="ce-step-text"><span>PASSO 03</span><strong>Branding</strong></div>
              </div>
              <div className={`ce-step-item ${step === 4 ? 'active' : ''}`}>
                <div className="ce-step-num">4</div>
                <div className="ce-step-text"><span>PASSO 04</span><strong>Revisão</strong></div>
              </div>
            </div>

            <div className="modal-admin-body">
              {step === 1 && (
                <>
                  <div className="ce-field-group">
                    <label>Nome Completo da Escola *</label>
                    <input type="text" id="nome_escola" placeholder="Ex: Escola Evangélica Irmã Leopoldina" value={formData.nome_escola} onChange={handleChange} className="ce-input" />
                  </div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group"><label>Sigla *</label><input type="text" id="sigla" value={formData.sigla} onChange={handleChange} className="ce-input" /></div>
                    <div className="ce-field-group"><label>Subdomínio</label><input type="text" id="subdominio" value={formData.subdominio} readOnly className="ce-input" style={{ background: '#f1f5f9' }} /></div>
                  </div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group"><label>Nome do Diretor</label><input type="text" id="diretor_nome" value={formData.diretor_nome} onChange={handleChange} className="ce-input" /></div>
                    <div className="ce-field-group">
                      <label>Tipo de Gestão *</label>
                      <select id="categoria" value={formData.categoria} onChange={handleChange} className="ce-select">
                        {TIPOS_GESTAO?.map((t, idx) => (
                          <option key={idx} value={idx === 0 ? '' : String(idx)}>{t.nome || `Categoria ${idx}`}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group"><label>Contacto do Diretor</label><GuineaBissauPhoneInput id="diretor_contacto" value={formData.diretor_contacto} onChange={(value) => setFormData((current) => ({ ...current, diretor_contacto: value }))} className="ce-input" /></div>
                    <div className="ce-field-group"><label>Email do Diretor</label><input type="email" id="diretor_email" value={formData.diretor_email} onChange={handleChange} className="ce-input" /></div>
                  </div>

                  <div className="ce-field-group" style={{ marginTop: '12px' }}>
                    <label style={{ fontWeight: 'bold', color: '#1e293b' }}>
                      Níveis Académicos Ofertados nesta Escola (Selecione os aplicáveis; pode deixar vazio)
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px', marginTop: '6px' }}>
                      {!loadingNiveis && !niveisErro && niveisEnsino.length > 0 && formData.niveis_ids.length === 0 && (
                        <p style={{ gridColumn: '1 / -1', margin: 0, color: '#64748b', fontSize: '12px' }}>
                          Sem níveis selecionados, o código académico do login será 0.
                        </p>
                      )}
                      {loadingNiveis && <p>A carregar níveis de ensino...</p>}
                      {!loadingNiveis && niveisErro && <p role="alert">{niveisErro}</p>}
                      {!loadingNiveis && !niveisErro && niveisEnsino.length === 0 && <p>Não existem níveis de ensino configurados.</p>}
                      {!loadingNiveis && !niveisErro && niveisEnsino.map((nivel) => {
                        const id = String(nivel.id);
                        const isSelected = formData.niveis_ids.includes(id);
                        return (
                          <button 
                            key={id} 
                            type="button" 
                            onClick={() => toggleNivelEnsino(id)} 
                            style={{ 
                              padding: '10px 12px', 
                              borderRadius: '8px', 
                              border: isSelected ? '2px solid #0284c7' : '1px solid #cbd5e1', 
                              background: isSelected ? '#e0f2fe' : '#ffffff', 
                              color: isSelected ? '#0369a1' : '#475569', 
                              fontSize: '12px', 
                              fontWeight: '700', 
                              textAlign: 'left', 
                              cursor: 'pointer', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'space-between' 
                            }}
                          >
                            <span>{nivel.nome}</span>
                            <span>{isSelected ? '✓' : '+'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                </>
              )}

              {step === 2 && (
                <>
                  <div className="modal-grid-2">
                    <div className="ce-field-group"><label>NIF</label><input type="text" id="nif" value={formData.nif} onChange={handleChange} className="ce-input" /></div>
                    <div className="ce-field-group"><label>Licença MEN</label><input type="text" id="licenca_men" value={formData.licenca_men} onChange={handleChange} className="ce-input" /></div>
                  </div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group">
                      <label>Região da Guiné-Bissau</label>
                      <select id="local" value={formData.local} onChange={handleChange} className="ce-select">
                        {Object.keys(GUINE_REGIOES).map((regKey) => (
                          <option key={regKey} value={regKey}>{GUINE_REGIOES[regKey].nome}</option>
                        ))}
                      </select>
                    </div>
                    <div className="ce-field-group">
                      <label>Sector / Bairro</label>
                      <select id="bairro" value={formData.bairro} onChange={handleChange} className="ce-select">
                        <option value="">Selecione a localidade</option>
                        {localidadesDisponiveis.map((b, idx) => (<option key={idx} value={b}>{b}</option>))}
                      </select>
                    </div>
                  </div>
                  <div className="ce-field-group"><label>Endereço Detalhado / Rua</label><input type="text" id="endereco" value={formData.endereco} onChange={handleChange} className="ce-input" /></div>
                  <div className="ce-field-group"><label>Regime / Período Escolar</label><input type="text" id="regime_periodo" value={formData.regime_periodo} onChange={handleChange} className="ce-input" /></div>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="modal-grid-2">
                    <div className="ce-field-group"><label>Cor Primária</label><input type="color" id="cor_primaria" value={formData.cor_primaria} onChange={handleChange} className="ce-input" style={{ height: '40px', padding: '2px' }} /></div>
                    <div className="ce-field-group">
                      <label>Foto / Logótipo da Escola (JPEG, PNG ou WebP; até 5 MB)</label>
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => handlePhotoChange(e, 'create')} className="ce-input" />
                      {processingPhoto && <small>A preparar logótipo...</small>}
                      {formData.logo_url && <NextImage src={formData.logo_url} alt="Pré-visualização do logótipo" width={80} height={80} unoptimized style={{ display: 'block', objectFit: 'contain', marginTop: '8px', borderRadius: '8px' }} />}
                    </div>
                  </div>
                  <div className="ce-field-group"><label>Motto / Lema</label><input type="text" id="motto" value={formData.motto} onChange={handleChange} className="ce-input" /></div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group"><label>Missão</label><input type="text" id="missao" value={formData.missao} onChange={handleChange} className="ce-input" maxLength="255" /></div>
                    <div className="ce-field-group"><label>Valor</label><input type="text" id="valor" value={formData.valor} onChange={handleChange} className="ce-input" maxLength="255" /></div>
                  </div>
                  <div className="ce-field-group">
                    <label>Visão (máximo 500 palavras)</label>
                    <textarea id="visao" value={formData.visao} onChange={handleChange} className="ce-input" rows="3" />
                    <small>{contarPalavras(formData.visao)} / 500 palavras</small>
                  </div>
                </>
              )}

              {step === 4 && (
                direcaoGerada ? (
                  <div role="status" style={{ background: '#f0fdf4', border: '1px solid #86efac', padding: '16px', borderRadius: '8px' }}>
                    <h3>Conta da Direção criada</h3>
                    <p>Guarde estes dados agora. A password temporária não será apresentada novamente.</p>
                    <p><strong>Nome:</strong> {direcaoGerada.nome}</p>
                    <p><strong>Login:</strong> {direcaoGerada.login_id}</p>
                    <p><strong>Email:</strong> {direcaoGerada.email}</p>
                    <p><strong>Password temporária:</strong> <code>{direcaoGerada.password_temporaria}</code></p>
                  </div>
                ) : (
                  <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px' }}>
                    <p><strong>Escola:</strong> {formData.nome_escola}</p>
                    <p><strong>Sigla / Subdomínio:</strong> {formData.sigla} / {formData.subdominio}.future-se.gw</p>
                    <p><strong>Tipo de gestão:</strong> {TIPOS_GESTAO[Number(formData.categoria)]?.nome}</p>
                    <p><strong>Níveis selecionados:</strong> {getNivelTexto(formData.niveis_ids)}</p>
                    <p><strong>Diretor:</strong> {formData.diretor_nome || 'Não informado'}</p>
                    <p><strong>Contacto / Email:</strong> {formData.diretor_contacto || '—'} / {formData.diretor_email || '—'}</p>
                    <p><strong>Região / Sector:</strong> {GUINE_REGIOES[formData.local]?.nome} - {formData.bairro || 'Não informado'}</p>
                    <p><strong>Endereço:</strong> {formData.endereco || 'Não informado'}</p>
                    <p><strong>Regime:</strong> {formData.regime_periodo || 'Não informado'}</p>
                    <p><strong>NIF / Licença MEN:</strong> {formData.nif || '—'} / {formData.licenca_men || '—'}</p>
                    <p><strong>Lema / Visão:</strong> {formData.motto || '—'} / {formData.visao || '—'}</p>
                    <p><strong>Missão / Valor:</strong> {formData.missao || '—'} / {formData.valor || '—'}</p>
                    {formData.logo_url && <NextImage src={formData.logo_url} alt="Logótipo da escola" width={80} height={80} unoptimized style={{ objectFit: 'contain' }} />}
                    <label style={{ display: 'flex', gap: '8px', marginTop: '10px', cursor: 'pointer', fontSize: '12px' }}>
                      <input type="checkbox" id="aceitou_termos" checked={formData.aceitou_termos} onChange={handleChange} />
                      Confirmo os dados e aceito os termos de utilização.
                    </label>
                  </div>
                )
              )}

              <div className="ce-actions-footer" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
                {direcaoGerada ? (
                  <button type="button" onClick={fecharModalNovaEscola} className="ce-btn-submit">Concluir</button>
                ) : step > 1 ? <button type="button" onClick={handleBack} className="ce-btn-back"><BsArrowLeft /> Voltar</button> : <div />}
                {!direcaoGerada && step < 4 ? (
                  <button type="button" onClick={handleNext} className="ce-btn-submit">Seguinte <BsArrowRight /></button>
                ) : !direcaoGerada ? (
                  <button type="button" onClick={handleSubmitFinal} disabled={submitting || processingPhoto || !formData.aceitou_termos} className="ce-btn-submit">
                    <BsCheck2Circle /> {submitting ? "A registar..." : "Finalizar & Criar"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE VISUALIZAÇÃO EM FORMATO DE FICHA INSTITUCIONAL */}
      {selectedEscolaView && (
        <div className="modal-admin-overlay" onClick={() => setSelectedEscolaView(null)}>
          <div className="modal-admin-box" style={{ maxWidth: '820px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-admin-header" style={{ background: selectedEscolaView.cor_primaria || '#0284c7', color: '#fff' }}>
              <h2>FICHA INSTITUCIONAL: {selectedEscolaView.nome}</h2>
              <button className="btn-modal-close" onClick={() => setSelectedEscolaView(null)} style={{ color: '#fff' }}>✕</button>
            </div>
            <div className="modal-admin-body escola-ficha-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px' }}>
                {selectedEscolaView.logo_url ? (
                  <NextImage src={selectedEscolaView.logo_url} alt={`Logótipo de ${selectedEscolaView.nome}`} width={88} height={88} unoptimized style={{ objectFit: 'contain', borderRadius: '12px', background: '#fff' }} />
                ) : (
                  <div style={{ width: '64px', height: '64px', background: selectedEscolaView.cor_primaria || '#0284c7', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '24px', fontWeight: 'bold' }}>
                    {selectedEscolaView.sigla}
                  </div>
                )}
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', color: '#1e293b' }}>{selectedEscolaView.nome}</h3>
                  <p style={{ margin: '2px 0 0 0', color: '#64748b', fontSize: '13px' }}>Sigla: <strong>{selectedEscolaView.sigla || '—'}</strong></p>
                  <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>Subdomínio: <strong>{selectedEscolaView.subdominio}.future-se.gw</strong></p>
                  <p style={{ margin: '2px 0 0 0', color: '#64748b', fontSize: '13px' }}>Tipo de gestão: <strong>{TIPOS_GESTAO[Number(selectedEscolaView.categoria)]?.nome || selectedEscolaView.categoria || '—'}</strong></p>
                  <p style={{ margin: '2px 0 0 0', color: '#64748b', fontSize: '13px' }}>Níveis: <strong>{getNivelTexto(selectedEscolaView.niveis_ids)}</strong></p>
                </div>
              </div>

              <div className="ficha-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '15px' }}>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>NIF</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.nif || 'N/A'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>LICENÇA MEN</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.licenca_men || 'N/A'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>ESTADO</span>
                  <strong style={{ fontSize: '14px', color: selectedEscolaView.status_verificacao === 'ativo' || selectedEscolaView.status_verificacao === 'verified' ? '#16a34a' : '#dc2626' }}>
                    {selectedEscolaView.status_verificacao === 'ativo' || selectedEscolaView.status_verificacao === 'verified' ? 'Ativo' : 'Desativado'}
                  </strong>
                </div>
              </div>

              <div className="ficha-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '15px' }}>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>ID DA ESCOLA</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.id}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>CONTACTO DO DIRETOR</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.diretor_contacto || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>TOTAL DE ALUNOS</span>
                  <strong style={{ fontSize: '14px', color: '#0284c7' }}>{selectedEscolaView.totalAlunos ?? '—'}</strong>
                </div>
              </div>

              <div className="ficha-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>REGIÃO</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{GUINE_REGIOES[selectedEscolaView.local]?.nome || selectedEscolaView.local || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>SECTOR / BAIRRO</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.sector || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>REGIME / PERÍODO</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.regime_periodo || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', gridColumn: 'span 2' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>ENDEREÇO / MORADA</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.endereco || selectedEscolaView.morada || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>COR INSTITUCIONAL</span>
                  <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#1e293b' }}>
                    <span style={{ width: '16px', height: '16px', borderRadius: '50%', background: selectedEscolaView.cor_primaria || '#0284c7' }} />
                    {selectedEscolaView.cor_primaria || '#0284c7'}
                  </strong>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>EMAIL DA ESCOLA</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.email || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>CONTACTO DA ESCOLA</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.contacto || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>DIRETOR</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.diretor_nome || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>EMAIL DO DIRETOR</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.diretor_email || '—'}</strong>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>LEMA / MOTTO</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.motto || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>VISÃO</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.visao || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>MISSÃO</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.missao || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>VALOR</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.valor || '—'}</strong>
                </div>
                <div className="ficha-info-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>DESCRIÇÃO</span>
                  <strong style={{ fontSize: '14px', color: '#1e293b' }}>{selectedEscolaView.descricao || '—'}</strong>
                </div>
              </div>

              <div className="modal-footer-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '15px' }}>
                <button type="button" onClick={() => setSelectedEscolaView(null)} className="ce-btn-back">Fechar</button>
                <button onClick={() => window.print()} className="ce-btn-submit"><BsPrinter /> Imprimir Ficha</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO COMPLETA */}
      {selectedEscolaEdit && (
        <div className="modal-admin-overlay" onClick={() => setSelectedEscolaEdit(null)}>
          <div className="modal-admin-box" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-admin-header">
              <h2>EDITAR ESCOLA: {selectedEscolaEdit.sigla}</h2>
              <button className="btn-modal-close" onClick={() => setSelectedEscolaEdit(null)}>✕</button>
            </div>
            <form onSubmit={handleSaveEdit} className="modal-admin-body" style={{ padding: '20px' }}>
              <div className="ce-field-group">
                <label>Nome da Escola</label>
                <input 
                  type="text" 
                  value={selectedEscolaEdit.nome || ''} 
                  onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, nome: e.target.value})} 
                  className="ce-input" 
                  required 
                />
              </div>
              <div className="modal-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="ce-field-group">
                  <label>Sigla</label>
                  <input 
                    type="text" 
                    value={selectedEscolaEdit.sigla || ''} 
                    onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, sigla: e.target.value})} 
                    className="ce-input" 
                  />
                </div>
                <div className="ce-field-group">
                  <label>NIF</label>
                  <input 
                    type="text" 
                    value={selectedEscolaEdit.nif || ''} 
                    onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, nif: e.target.value})} 
                    className="ce-input" 
                  />
                </div>
              </div>
              <div className="modal-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="ce-field-group">
                  <label>Contacto</label>
                  <GuineaBissauPhoneInput
                    value={selectedEscolaEdit.contacto || ''} 
                    onChange={(value) => setSelectedEscolaEdit((current) => ({ ...current, contacto: value }))} 
                    className="ce-input" 
                  />
                </div>
                <div className="ce-field-group">
                  <label>Email</label>
                  <input 
                    type="email" 
                    value={selectedEscolaEdit.email || ''} 
                    onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, email: e.target.value})} 
                    className="ce-input" 
                  />
                </div>
              </div>
              <div className="ce-field-group">
                <label>Descrição</label>
                <textarea 
                  value={selectedEscolaEdit.descricao || ''} 
                  onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, descricao: e.target.value})} 
                  className="ce-input"
                  rows="3"
                />
              </div>
              <div className="ce-field-group">
                <label>Morada</label>
                <input 
                  type="text" 
                  value={selectedEscolaEdit.morada || ''} 
                  onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, morada: e.target.value})} 
                  className="ce-input" 
                />
              </div>
              <div className="modal-grid-2">
                <div className="ce-field-group">
                  <label>Categoria / Tipo de gestão</label>
                  <select value={selectedEscolaEdit.categoria} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, categoria: e.target.value})} className="ce-select">
                    <option value="">Selecione</option>
                    {TIPOS_GESTAO.slice(1).map((tipo, index) => (
                      <option key={tipo.id} value={String(index + 1)}>{tipo.nome}</option>
                    ))}
                  </select>
                </div>
                <div className="ce-field-group">
                  <label>Região</label>
                  <select value={selectedEscolaEdit.local || ''} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, local: e.target.value})} className="ce-select">
                    <option value="">Selecione</option>
                    {Object.entries(GUINE_REGIOES).map(([key, regiao]) => (
                      <option key={key} value={key}>{regiao.nome}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="modal-grid-2">
                <div className="ce-field-group">
                  <label>Sector / Bairro</label>
                  <input type="text" value={selectedEscolaEdit.sector || ''} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, sector: e.target.value})} className="ce-input" />
                </div>
                <div className="ce-field-group">
                  <label>Regime / Período Escolar</label>
                  <input type="text" value={selectedEscolaEdit.regime_periodo || ''} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, regime_periodo: e.target.value})} className="ce-input" />
                </div>
              </div>
              <div className="modal-grid-2">
                <div className="ce-field-group">
                  <label htmlFor="escola-subdominio">Subdomínio do portal</label>
                  <input
                    id="escola-subdominio"
                    type="text"
                    value={selectedEscolaEdit.subdominio || ''}
                    onChange={(e) => setSelectedEscolaEdit({
                      ...selectedEscolaEdit,
                      subdominio: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63)
                    })}
                    className="ce-input"
                    autoComplete="off"
                    maxLength={63}
                    pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
                    aria-describedby="escola-subdominio-ajuda"
                  />
                  <small id="escola-subdominio-ajuda">
                    O portal ficará em: <strong>{selectedEscolaEdit.subdominio || 'subdominio'}.futurese.com</strong>.
                    Use letras minúsculas, números e hífen. Deixe vazio para remover o subdomínio.
                  </small>
                </div>
                <div className="ce-field-group">
                  <label>Licença MEN</label>
                  <input type="text" value={selectedEscolaEdit.licenca_men || ''} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, licenca_men: e.target.value})} className="ce-input" />
                </div>
              </div>
              <div className="ce-field-group">
                <label>Níveis de ensino</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {niveisEnsino.map((nivel) => {
                    const nivelId = String(nivel.id);
                    const selecionado = selectedEscolaEdit.niveis_ids.some((id) => String(id) === nivelId);
                    return (
                      <button
                        key={nivelId}
                        type="button"
                        onClick={() => setSelectedEscolaEdit((prev) => ({
                          ...prev,
                          niveis_ids: selecionado
                            ? prev.niveis_ids.filter((id) => String(id) !== nivelId)
                            : [...prev.niveis_ids, nivelId]
                        }))}
                        style={{
                          border: `1px solid ${selecionado ? '#0284c7' : '#cbd5e1'}`,
                          background: selecionado ? '#e0f2fe' : '#fff',
                          color: selecionado ? '#0369a1' : '#475569',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          cursor: 'pointer'
                        }}
                      >
                        {selecionado ? '✓ ' : '+ '}{nivel.nome}
                      </button>
                    );
                  })}
                  {niveisEnsino.length === 0 && <small>{niveisErro || 'Níveis de ensino indisponíveis.'}</small>}
                </div>
              </div>
              <div className="modal-grid-2">
                <div className="ce-field-group">
                  <label>Cor Primária</label>
                  <input type="color" value={selectedEscolaEdit.cor_primaria || '#0284c7'} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, cor_primaria: e.target.value})} className="ce-input" style={{ height: '40px', padding: '2px' }} />
                </div>
                <div className="ce-field-group">
                  <label>Foto / Logótipo (JPEG, PNG ou WebP; ficheiro até 5 MB)</label>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => handlePhotoChange(e, 'edit')} className="ce-input" />
                  {processingPhoto && <small>A preparar logótipo...</small>}
                  {selectedEscolaEdit.logo_url && <NextImage src={selectedEscolaEdit.logo_url} alt="Pré-visualização do logótipo" width={80} height={80} unoptimized style={{ display: 'block', objectFit: 'contain', marginTop: '8px', borderRadius: '8px' }} />}
                  {(selectedEscolaEdit.logo_url || selectedEscolaEdit.remover_logo) && (
                    <button type="button" className="ce-btn-back" onClick={() => setSelectedEscolaEdit({...selectedEscolaEdit, logo_url: '', remover_logo: true})} style={{ marginTop: '8px' }}>
                      Remover foto
                    </button>
                  )}
                </div>
              </div>
              <div className="modal-grid-2">
                <div className="ce-field-group">
                  <label>Diretor</label>
                  <input type="text" value={selectedEscolaEdit.diretor_nome || ''} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, diretor_nome: e.target.value})} className="ce-input" />
                </div>
                <div className="ce-field-group">
                  <label>Contacto do Diretor</label>
                  <GuineaBissauPhoneInput value={selectedEscolaEdit.diretor_contacto || ''} onChange={(value) => setSelectedEscolaEdit((current) => ({ ...current, diretor_contacto: value }))} className="ce-input" />
                </div>
              </div>
              <div className="ce-field-group">
                <label>Email do Diretor</label>
                <input type="email" value={selectedEscolaEdit.diretor_email || ''} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, diretor_email: e.target.value})} className="ce-input" />
              </div>
              <div className="ce-field-group">
                <label>Lema / Motto</label>
                <input type="text" value={selectedEscolaEdit.motto || ''} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, motto: e.target.value})} className="ce-input" />
              </div>
              <div className="ce-field-group">
                <label>Visão (máximo 500 palavras)</label>
                <textarea value={selectedEscolaEdit.visao || ''} onChange={(e) => {
                  if (contarPalavras(e.target.value) > 500) {
                    showFeedback('A visão da escola não pode ultrapassar 500 palavras.');
                    return;
                  }
                  setSelectedEscolaEdit({...selectedEscolaEdit, visao: e.target.value});
                }} className="ce-input" rows="3" />
                <small>{contarPalavras(selectedEscolaEdit.visao || '')} / 500 palavras</small>
              </div>
              <div className="ce-field-group">
                <label>Missão</label>
                <input type="text" value={selectedEscolaEdit.missao || ''} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, missao: e.target.value})} className="ce-input" maxLength="255" />
              </div>
              <div className="ce-field-group">
                <label>Valor</label>
                <input type="text" value={selectedEscolaEdit.valor || ''} onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, valor: e.target.value})} className="ce-input" maxLength="255" />
              </div>
              <div className="ce-field-group">
                <label>Estado da Escola</label>
                <select 
                  value={selectedEscolaEdit.status || 'Ativo'} 
                  onChange={(e) => setSelectedEscolaEdit({...selectedEscolaEdit, status: e.target.value})} 
                  className="ce-select"
                >
                  <option value="Ativo">Ativo</option>
                  <option value="Desativado">Desativado</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" onClick={() => setSelectedEscolaEdit(null)} className="ce-btn-back">Cancelar</button>
                <button type="submit" disabled={processingPhoto} className="ce-btn-submit">Guardar Alterações</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}