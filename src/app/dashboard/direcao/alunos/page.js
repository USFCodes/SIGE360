'use client';

import React, { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { 
  BsSearch, BsEye, BsPencilSquare, BsJournalText, BsCamera,
  BsToggleOn, BsToggleOff, BsChevronLeft, BsChevronRight, BsThreeDots 
} from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';
import GuineaBissauPhoneInput from '@/components/GuineaBissauPhoneInput';
import '@/styles/direcao-inline-alunos.css';
import '@/styles/adm-alunos.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api`;

async function lerRespostaApi(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Falha no pedido à API (HTTP ${response.status}).`);
  }
  return data;
}

export default function GestaoAlunosDirecaoPage() {
  const [selectedPolo, setSelectedPolo] = useState('');
  const [selectedAnoLetivo, setSelectedAnoLetivo] = useState('');
  const [selectedSituacaoTurma, setSelectedSituacaoTurma] = useState('');
  const [selectedProfessor, setSelectedProfessor] = useState('');
  const [selectedDisciplina, setSelectedDisciplina] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 20;

  const [selectedAlunoProfile, setSelectedAlunoProfile] = useState(null);
  const [selectedAlunoFicha, setSelectedAlunoFicha] = useState(null);
  const [fotoSelecionada, setFotoSelecionada] = useState(null);
  const [fotoPreview, setFotoPreview] = useState('');
  const [loadingFicha, setLoadingFicha] = useState(false);
  const [errorFicha, setErrorFicha] = useState('');
  const [fichaRefreshKey, setFichaRefreshKey] = useState(0);
  const [savingProfile, setSavingProfile] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [formDataEdit, setFormDataEdit] = useState({});
  const selectedAlunoId = selectedAlunoProfile?.aluno_id || selectedAlunoProfile?.id || '';

  const { data: dadosGlobais, error: erroGlobal, isLoading: loadingGlobal } = useSWR(
    'direcao-alunos-dados-globais',
    async () => {
      const resSessao = await fetch(`${API_URL}/v1/auth/me`, { credentials: 'include', cache: 'no-store' });
      const sessao = await lerRespostaApi(resSessao);
      const contaAtiva = sessao.data?.conta_ativa;
      if (!contaAtiva?.escola_id) {
        throw new Error('Não foi encontrada uma escola ativa para esta conta.');
      }
      const escolaId = contaAtiva.escola_id;

      const [resPolos, resAnos, resProf, resDisc] = await Promise.all([
        fetch(`${API_URL}/v1/escolas/escolas/${encodeURIComponent(escolaId)}/polos`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API_URL}/v1/direcao/notas/anos-letivos`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API_URL}/v1/escolas/escolas/${encodeURIComponent(escolaId)}/funcionarios`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API_URL}/v1/escolas/disciplinas`, { credentials: 'include', cache: 'no-store' })
      ]);

      const [dadosPolos, dadosAnos, dadosProf, dadosDisc] = await Promise.all([
        lerRespostaApi(resPolos),
        lerRespostaApi(resAnos),
        lerRespostaApi(resProf).catch(() => ({ data: [] })),
        lerRespostaApi(resDisc).catch(() => ({ data: [] }))
      ]);

      const listaAnos = Array.isArray(dadosAnos.dados) ? dadosAnos.dados : (Array.isArray(dadosAnos.data) ? dadosAnos.data : []);
      const anoAtivo = listaAnos.find(a => a.ativo || a.atual) || listaAnos[0];
      const anoInicial = anoAtivo?.id || '';

      return {
        escolaId,
        nomeEscola: contaAtiva.escola_nome || 'Instituição',
        siglaEscola: contaAtiva.escola_sigla || '',
        polos: Array.isArray(dadosPolos.data) ? dadosPolos.data : [],
        anosLetivos: listaAnos,
        anoInicial,
        professores: (Array.isArray(dadosProf.data) ? dadosProf.data : []).filter(f => f.papel?.toLowerCase() === 'professor'),
        disciplinas: Array.isArray(dadosDisc.data) ? dadosDisc.data : []
      };
    },
    { revalidateIfStale: false, revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const escolaId = dadosGlobais?.escolaId || '';
  const nomeEscola = dadosGlobais?.nomeEscola || '';
  const siglaEscola = dadosGlobais?.siglaEscola || '';
  const escolasPolos = dadosGlobais?.polos || [];
  const listaAnosLetivos = dadosGlobais?.anosLetivos || [];
  const listaProfessores = dadosGlobais?.professores || [];
  const listaDisciplinas = dadosGlobais?.disciplinas || [];

  useEffect(() => {
    if (dadosGlobais) {
      if (!selectedPolo && escolasPolos.length > 0) {
        setSelectedPolo(escolasPolos[0].id_raw || escolasPolos[0].id);
      }
      if (!selectedAnoLetivo && dadosGlobais.anoInicial) {
        setSelectedAnoLetivo(dadosGlobais.anoInicial);
      }
    }
  }, [dadosGlobais, escolasPolos, selectedPolo, selectedAnoLetivo]);

  const { data: alunosDoPolo = [], error: erroAlunos, isLoading: loadingAlunos, mutate: atualizarAlunos } = useSWR(
    escolaId ? ['direcao-alunos-filtrados', escolaId, selectedPolo, selectedAnoLetivo, selectedSituacaoTurma, selectedProfessor, selectedDisciplina] : null,
    async ([, idEscola, polo, ano, situacaoTurma, prof, disc]) => {
      const params = new URLSearchParams();
      if (polo) params.append('polo_id', polo);
      if (ano) params.append('ano_letivo_id', ano);
      if (situacaoTurma) params.append('situacao_turma', situacaoTurma);
      if (prof) params.append('professor_id', prof);
      if (disc) params.append('disciplina_id', disc);

      const res = await fetch(`${API_URL}/v1/alunos/${encodeURIComponent(idEscola)}/alunos?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store'
      });
      const data = await lerRespostaApi(res);
      return Array.isArray(data.data) ? data.data : [];
    },
    { revalidateIfStale: false, revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const erro = erroGlobal?.message || erroAlunos?.message || '';

  const alunosFiltrados = useMemo(() => {
    return alunosDoPolo.filter(a => {
      const nome = (a.nome || a.aluno_nome || '').toLowerCase();
      const apelido = (a.apelido || '').toLowerCase();
      const matricula = (a.login_id || a.numero_matricula || '').toLowerCase();
      const encarregado = (a.encarregado_nome || '').toLowerCase();
      const term = searchTerm.toLowerCase();
      return nome.includes(term) || apelido.includes(term) || matricula.includes(term) || encarregado.includes(term);
    });
  }, [alunosDoPolo, searchTerm]);

  const totalPaginas = Math.ceil(alunosFiltrados.length / itensPorPagina) || 1;
  const alunosPaginados = useMemo(() => {
    const inicio = (paginaAtual - 1) * itensPorPagina;
    return alunosFiltrados.slice(inicio, inicio + itensPorPagina);
  }, [alunosFiltrados, paginaAtual]);

  useEffect(() => {
    setPaginaAtual(1);
  }, [searchTerm, selectedPolo, selectedAnoLetivo, selectedSituacaoTurma, selectedProfessor, selectedDisciplina]);

  const handleOpenPerfil = (aluno) => {
    setSelectedAlunoProfile(aluno);
    setSelectedAlunoFicha(null);
    setFotoSelecionada(null);
    setFotoPreview(aluno.foto_url || '');
    setErrorFicha('');
    setIsEditingProfile(false);
    setFormDataEdit({
      nome: aluno.nome || aluno.aluno_nome || '',
      apelido: aluno.apelido || '',
      telefone: aluno.telefone || aluno.aluno_telefone || '',
      email: aluno.email || aluno.aluno_email || '',
      foto_url: aluno.foto_url || '',
      genero: aluno.genero || 'Masculino',
      nacionalidade: aluno.nacionalidade || 'Guineense',
      numero_identificacao: aluno.numero_identificacao || '',
      data_nascimento: aluno.data_nascimento ? String(aluno.data_nascimento).slice(0, 10) : '',
      regiao_origem: aluno.regiao_origem || '',
      local_origem: aluno.local_origem || '',
      regiao_morada: aluno.regiao_morada || '',
      setor_morada: aluno.setor_morada || '',
      endereco_morada: aluno.endereco_morada || '',
      ultima_escola_frequentada: aluno.ultima_escola_frequentada || '',
      status_ativo: aluno.status_ativo !== false,
      encarregados: []
    });
  };

  const fecharPerfil = () => {
    setSelectedAlunoProfile(null);
    setSelectedAlunoFicha(null);
    setFotoSelecionada(null);
    setFotoPreview('');
    setIsEditingProfile(false);
  };

  useEffect(() => {
    if (!selectedAlunoId || !escolaId) return undefined;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (selectedAnoLetivo) params.set('ano_letivo_id', selectedAnoLetivo);
    setLoadingFicha(true);
    setErrorFicha('');
    fetch(`${API_URL}/v1/alunos/${encodeURIComponent(escolaId)}/alunos/${encodeURIComponent(selectedAlunoId)}/ficha?${params}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal
    })
      .then(lerRespostaApi)
      .then((response) => {
        setSelectedAlunoFicha(response.data);
        const aluno = response.data?.aluno || {};
        const utilizador = response.data?.utilizador || {};
        const encarregados = Array.isArray(response.data?.encarregados) ? response.data.encarregados : [];
        setFotoPreview(aluno.foto_url || '');
        setFormDataEdit({
          nome: utilizador.nome || '',
          apelido: aluno.apelido || '',
          telefone: utilizador.telefone || '',
          email: utilizador.email || '',
          foto_url: aluno.foto_url || '',
          genero: aluno.genero || '',
          nacionalidade: aluno.nacionalidade || '',
          numero_identificacao: aluno.numero_identificacao || '',
          data_nascimento: aluno.data_nascimento ? String(aluno.data_nascimento).slice(0, 10) : '',
          regiao_origem: aluno.regiao_origem || '',
          local_origem: aluno.local_origem || '',
          regiao_morada: aluno.regiao_morada || '',
          setor_morada: aluno.setor_morada || '',
          endereco_morada: aluno.endereco_morada || '',
          ultima_escola_frequentada: aluno.ultima_escola_frequentada || '',
          status_ativo: utilizador.status_ativo === true,
          encarregados: encarregados.map((encarregado) => ({
            id: encarregado.id,
            nome: encarregado.utilizador.nome || '',
            apelido: encarregado.apelido || '',
            parentesco: encarregado.parentesco || '',
            telefone: encarregado.utilizador.telefone || '',
            email: encarregado.utilizador.email || '',
            occupacao: encarregado.occupacao || '',
            regiao_morada: encarregado.regiao_morada || '',
            setor_morada: encarregado.setor_morada || '',
            numero_identificacao: encarregado.numero_identificacao || ''
          }))
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error('Erro ao carregar ficha completa do aluno:', error);
        setErrorFicha(error.message || 'Não foi possível carregar os dados completos do aluno.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFicha(false);
      });
    return () => controller.abort();
  }, [escolaId, selectedAlunoId, selectedAnoLetivo, fichaRefreshKey]);

  useEffect(() => {
    if (!fotoPreview.startsWith('blob:')) return undefined;
    return () => URL.revokeObjectURL(fotoPreview);
  }, [fotoPreview]);

  const selecionarFoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Escolha uma fotografia JPG, PNG ou WEBP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('A fotografia deve ter no máximo 5 MB.');
      return;
    }
    setFotoSelecionada(file);
    setFotoPreview(URL.createObjectURL(file));
  };

  const atualizarEncarregadoEdit = (index, campo, valor) => {
    setFormDataEdit((current) => ({
      ...current,
      encarregados: current.encarregados.map((encarregado, itemIndex) =>
        itemIndex === index ? { ...encarregado, [campo]: valor } : encarregado)
    }));
  };

  const urlNotasAluno = (aluno) => {
    const params = new URLSearchParams();
    params.set('aluno_id', aluno.aluno_id || aluno.id);
    if (selectedAnoLetivo) params.set('ano_letivo_id', selectedAnoLetivo);
    if (aluno.turma_id) params.set('turma_id', aluno.turma_id);
    return `/dashboard/direcao/notas?${params.toString()}`;
  };

  const handleSalvarEdicao = async (e) => {
    e.preventDefault();
    const alunoId = selectedAlunoProfile.aluno_id || selectedAlunoProfile.id;
    setSavingProfile(true);
    try {
      const body = new FormData();
      Object.entries(formDataEdit).forEach(([campo, valor]) => {
        if (campo !== 'foto_url' && campo !== 'encarregados' && valor !== undefined && valor !== null) {
          body.append(campo, String(valor));
        }
      });
      body.append('encarregados', JSON.stringify(formDataEdit.encarregados || []));
      if (fotoSelecionada) body.append('foto', fotoSelecionada);
      const res = await fetch(`${API_URL}/v1/alunos/${encodeURIComponent(alunoId)}`, {
        method: 'PUT',
        credentials: 'include',
        body
      });
      const data = await lerRespostaApi(res);
      if (data.success) {
        alert(data.message || 'Dados do aluno atualizados com sucesso!');
        setIsEditingProfile(false);
        await atualizarAlunos();
        setSelectedAlunoProfile({ ...selectedAlunoProfile, ...formDataEdit, foto_url: fotoPreview });
        setFotoSelecionada(null);
        setFichaRefreshKey((key) => key + 1);
      }
    } catch (err) {
      console.error('Erro ao atualizar dados do aluno:', err);
      alert(err.message || 'Não foi possível atualizar os dados do aluno.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleToggleStatus = async (aluno) => {
    const alunoId = aluno.aluno_id || aluno.id;
    const novoEstado = !aluno.status_ativo;
    if (!window.confirm(`Tem certeza que deseja ${novoEstado ? 'ativar' : 'desativar'} a conta deste aluno?`)) return;

    try {
      const res = await fetch(`${API_URL}/v1/alunos/${encodeURIComponent(alunoId)}/status`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_ativo: novoEstado })
      });
      const data = await lerRespostaApi(res);
      if (data.success) {
        alert(data.message || 'Estado da conta alterado com sucesso.');
        await atualizarAlunos();
        if (selectedAlunoProfile) {
          setSelectedAlunoProfile({ ...selectedAlunoProfile, status_ativo: novoEstado });
        }
        setSelectedAlunoFicha((ficha) => ficha ? {
          ...ficha,
          utilizador: { ...ficha.utilizador, status_ativo: novoEstado }
        } : ficha);
      }
    } catch (err) {
      console.error('Erro ao alterar estado:', err);
      alert(err.message || 'Erro ao alterar o estado do aluno.');
    }
  };

  const imprimirRelatorio = () => {
    window.print();
  };

  return (
    <div className="escolas-container">
      {/* CABEÇALHO PARA IMPRESSÃO (Profissional) */}
      <div className="print-header-institucional">
        <h2>{nomeEscola} ({siglaEscola})</h2>
        <p>Relatório Institucional de Alunos · Ano Letivo: {listaAnosLetivos.find((ano) => ano.id === selectedAnoLetivo)?.ano_nome || 'Geral'}</p>
        <hr className="print-divider" />
      </div>

      {/* HEADER COM BOTÃO DE IMPRESSÃO INTEGRADO */}
      <div className="no-print">
        <AdminHeader 
          titulo="Gestão de Alunos por Polo" 
          descricao="Consulte os polos, aplique filtros pedagógicos e gira os alunos."
          modalBtn={null}
          escolaIdLogada={escolaId}
          onRefresh={() => atualizarAlunos()}
          loading={loadingGlobal || loadingAlunos}
          onPrint={imprimirRelatorio}
          printText="Imprimir Relatório"
        />
      </div>

      {erro && (
        <div role="alert" className="direcao-alunos-07e972455 no-print">
          {erro}
        </div>
      )}

      {/* BARRA DE FILTROS AVANÇADOS */}
      <div className="turmas-filter-bar no-print">
        <div className="filtro-grupo">
          <label>ANO LETIVO</label>
          <select value={selectedAnoLetivo} onChange={(e) => setSelectedAnoLetivo(e.target.value)} className="ce-select">
            <option value="">-- Todos os Anos --</option>
            {listaAnosLetivos.map(a => {
              return <option key={a.id} value={a.id}>{a.ano_nome || a.ano || a.nome}</option>;
            })}
          </select>
        </div>

        <div className="filtro-grupo">
          <label>POLO / RAMO</label>
          <select value={selectedPolo} onChange={(e) => setSelectedPolo(e.target.value)} className="ce-select">
            <option value="">-- Todos os Polos --</option>
            {escolasPolos.map(p => {
              const pId = p.id_raw || p.id;
              return <option key={pId} value={pId}>{p.nome}</option>;
            })}
          </select>
        </div>

        <div className="filtro-grupo">
          <label>TURMA</label>
          <select value={selectedSituacaoTurma} onChange={(e) => setSelectedSituacaoTurma(e.target.value)} className="ce-select">
            <option value="">-- Todas as Situações --</option>
            <option value="com_turma">Com turma</option>
            <option value="sem_turma">Sem Turma</option>
          </select>
        </div>

        <div className="filtro-grupo">
          <label>PROFESSOR</label>
          <select value={selectedProfessor} onChange={(e) => setSelectedProfessor(e.target.value)} className="ce-select">
            <option value="">-- Todos os Professores --</option>
            {listaProfessores.map(p => (
              <option key={p.funcionario_id || p.id} value={p.funcionario_id || p.id}>{p.nome}</option>
            ))}
          </select>
        </div>

        <div className="filtro-grupo">
          <label>DISCIPLINA</label>
          <select value={selectedDisciplina} onChange={(e) => setSelectedDisciplina(e.target.value)} className="ce-select">
            <option value="">-- Todas as Disciplinas --</option>
            {listaDisciplinas.map(d => (
              <option key={d.id} value={d.id}>{d.nome}</option>
            ))}
          </select>
        </div>
      </div>

      {/* PAINEL PRINCIPAL DE ALUNOS */}
      <main className="escolas-table-card">
        <div className="table-header-box">
          <div>
            <h2>LISTA DE ALUNOS REGISTADOS</h2>
            <span>Total filtrado: {alunosFiltrados.length} aluno(s)</span>
          </div>
          <div className="no-print search-box-wrapper">
            <div className="search-input-container">
              <BsSearch className="search-icon" />
              <input type="text" placeholder="Pesquisar por nome ou matrícula..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="table-responsive-wrapper">
          {loadingAlunos ? (
            <p className="loading-text">A carregar alunos...</p>
          ) : (
            <table className="escolas-custom-table">
              <thead>
                <tr>
                  <th>ALUNO</th>
                  <th>ID / MATRÍCULA</th>
                  <th>TURMA</th>
                  <th>ENCARREGADO</th>
                  <th>ESTADO</th>
                  <th className="no-print text-right">AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {alunosPaginados.length > 0 ? (
                  alunosPaginados.map(aluno => {
                    const idAluno = aluno.aluno_id || aluno.id;
                    const nomeCompleto = aluno.nome ? `${aluno.nome} ${aluno.apelido || ''}` : aluno.aluno_nome;
                    const matriculaId = aluno.login_id || aluno.numero_matricula;
                    const turmaNome = aluno.turma_nome || 'Sem Turma';
                    const encName = aluno.encarregado_nome || 'N/A';
                    const ativo = aluno.status_ativo !== false;
                    const candidatoPagamento = aluno.tipo_registo_lista === 'candidato_pagamento';

                    return (
                      <tr key={idAluno}>
                        <td>
                          <div className="user-cell-flex">
                            {aluno.foto_url ? (
                              <img src={aluno.foto_url} alt={nomeCompleto} className="user-avatar-img" />
                            ) : (
                              <div className="user-avatar-fallback">
                                {(nomeCompleto || 'AL').substring(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <strong className="user-name-strong">{nomeCompleto}</strong>
                              <span className="user-gender-span">{aluno.genero}</span>
                            </div>
                          </div>
                        </td>
                        <td><code>{matriculaId}</code></td>
                        <td>
                          <strong>{candidatoPagamento ? `Sem Turma · ${aluno.polo_nome || 'Polo não indicado'}` : turmaNome}</strong>
                        </td>
                        <td>
                          <div>{encName}</div>
                          <span className="user-gender-span">{aluno.encarregado_telefone}</span>
                        </td>
                        <td>
                          {candidatoPagamento ? (
                            <span className="badge-status-pill" style={{ background: aluno.estado_pagamento === 'aprovado' ? '#dcfce7' : '#fef3c7', color: aluno.estado_pagamento === 'aprovado' ? '#166534' : '#92400e' }}>
                              {aluno.estado_pagamento === 'aprovado' ? 'Pagamento aprovado · aguarda matrícula' : 'Pagamento pendente'}
                            </span>
                          ) : (
                            <span className={`badge-status-pill ${ativo ? 'ativo' : 'desativado'}`}>
                              {ativo ? 'Ativo' : 'Inativo'}
                            </span>
                          )}
                          {!candidatoPagamento && aluno.estado_matricula === 'pendente' && (
                            <span className="badge-status-pill" style={{ display: 'block', marginTop: '4px', background: '#fef3c7', color: '#92400e' }}>
                              Matrícula pendente
                            </span>
                          )}
                        </td>
                        <td className="no-print text-right">
                          {candidatoPagamento ? (
                            <span>Registo pendente na Secretaria</span>
                          ) : (
                          <div className="actions-buttons-flex">
                            <button className="btn-tb-act edit" onClick={() => handleOpenPerfil(aluno)} title="Ver Ficha Completa">
                              <BsEye /> Info
                            </button>
                            <a href={urlNotasAluno(aluno)} className="btn-tb-act edit" title="Ver Pauta de Notas">
                              <BsJournalText /> Notas
                            </a>
                            <button className="btn-tb-act" onClick={() => handleToggleStatus(aluno)} title={ativo ? "Desativar conta" : "Ativar conta"}>
                              {ativo ? <BsToggleOff size={16} /> : <BsToggleOn size={16} />}
                              {ativo ? 'Desativar' : 'Ativar'}
                            </button>
                          </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="6" className="empty-table-row">
                      Nenhum aluno encontrado com os filtros selecionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* PAGINAÇÃO BONITA E MODERNA (MÁX 20 POR VEZ) */}
        {totalPaginas > 1 && (
          <div className="no-print pagination-container">
            <div className="pagination-info">
              Mostrando <strong>{((paginaAtual - 1) * itensPorPagina) + 1}</strong> a <strong>{Math.min(paginaAtual * itensPorPagina, alunosFiltrados.length)}</strong> de <strong>{alunosFiltrados.length}</strong> registos
            </div>
            
            <div className="pagination-controls">
              <button 
                onClick={() => setPaginaAtual(p => Math.max(p - 1, 1))} 
                disabled={paginaAtual === 1} 
                className="pagination-btn-arrow"
              >
                <BsChevronLeft size={14} /> Anterior
              </button>

              <div className="pagination-numbers">
                {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                  .filter(num => num === 1 || num === totalPaginas || Math.abs(num - paginaAtual) <= 1)
                  .map((num, idx, arr) => {
                    const prev = arr[idx - 1];
                    const showEllipsis = prev && num - prev > 1;
                    return (
                      <React.Fragment key={num}>
                        {showEllipsis && <span className="pagination-ellipsis"><BsThreeDots size={12} /></span>}
                        <button
                          onClick={() => setPaginaAtual(num)}
                          className={`pagination-number-btn ${paginaAtual === num ? 'is-active' : ''}`}
                        >
                          {num}
                        </button>
                      </React.Fragment>
                    );
                  })}
              </div>

              <button 
                onClick={() => setPaginaAtual(p => Math.min(p + 1, totalPaginas))} 
                disabled={paginaAtual === totalPaginas} 
                className="pagination-btn-arrow"
              >
                Seguinte <BsChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: FICHA DE INFORMAÇÕES DETALHADAS & EDIÇÃO */}
      {selectedAlunoProfile && (
        <div className="modal-admin-overlay" onClick={fecharPerfil}>
          <div className="modal-admin-box modal-edit-profile-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-admin-header">
              <h2>FICHA DO ALUNO & PERFIL</h2>
              <button className="btn-modal-close" onClick={fecharPerfil}>✕</button>
            </div>

            <div className="modal-admin-body">
              <div className="modal-profile-top">
                {selectedAlunoFicha?.aluno?.foto_url || selectedAlunoProfile.foto_url || formDataEdit.foto_url ? (
                  <img src={selectedAlunoFicha?.aluno?.foto_url || formDataEdit.foto_url || selectedAlunoProfile.foto_url} alt="Foto" className="modal-profile-img" />
                ) : (
                  <div className="modal-profile-fallback">
                    {((selectedAlunoProfile.nome || 'AL')).substring(0, 2).toUpperCase()}
                  </div>
                )}
                <h3>{selectedAlunoFicha?.utilizador?.nome || selectedAlunoProfile.nome} {selectedAlunoFicha?.aluno?.apelido || selectedAlunoProfile.apelido}</h3>
                <span>ID / Matrícula: {selectedAlunoFicha?.utilizador?.login_id || selectedAlunoProfile.login_id || selectedAlunoProfile.numero_matricula}</span>
              </div>

              {!isEditingProfile ? (
                <>
                  {loadingFicha && <p className="loading-text">A carregar todos os dados do aluno...</p>}
                  {errorFicha && <p role="alert" className="direcao-alunos-07e972455">{errorFicha}</p>}
                  <div className="modal-info-grid">
                    <div>
                      <p>TURMA ATRIBUÍDA:</p>
                      <strong>{selectedAlunoFicha?.matriculas?.[0]?.turma?.nome || selectedAlunoProfile.turma_nome || 'Não atribuída'}</strong>
                    </div>
                    <div>
                      <p>GÉNERO:</p>
                      <strong>{selectedAlunoFicha?.aluno?.genero || selectedAlunoProfile.genero || 'Não informado'}</strong>
                    </div>
                    <div>
                      <p>TELEMÓVEL:</p>
                      <strong>{selectedAlunoFicha?.utilizador?.telefone || selectedAlunoProfile.telefone || 'Sem telemóvel'}</strong>
                    </div>
                    <div>
                      <p>ENCARREGADO:</p>
                      <strong>{selectedAlunoFicha?.encarregados?.map((encarregado) => `${encarregado.utilizador.nome} (${encarregado.parentesco || 'Encarregado'})`).join(', ') || `${selectedAlunoProfile.encarregado_nome || 'N/A'} (${selectedAlunoProfile.encarregado_telefone || 'sem telefone'})`}</strong>
                    </div>
                  </div>

                  {selectedAlunoFicha && (
                    <div className="modal-full-profile">
                      <section>
                        <h3>Dados do aluno e utilizador</h3>
                        <div className="modal-info-grid">
                          <div><p>EMAIL</p><strong>{selectedAlunoFicha.utilizador.email || 'Não informado'}</strong></div>
                          <div><p>DATA DE NASCIMENTO</p><strong>{selectedAlunoFicha.aluno.data_nascimento || 'Não informada'}</strong></div>
                          <div><p>NACIONALIDADE</p><strong>{selectedAlunoFicha.aluno.nacionalidade || 'Não informada'}</strong></div>
                          <div><p>IDENTIFICAÇÃO</p><strong>{selectedAlunoFicha.aluno.numero_identificacao || 'Não informada'}</strong></div>
                          <div><p>ORIGEM</p><strong>{[selectedAlunoFicha.aluno.regiao_origem, selectedAlunoFicha.aluno.local_origem].filter(Boolean).join(' / ') || 'Não informada'}</strong></div>
                          <div><p>REGIÃO / SETOR</p><strong>{[selectedAlunoFicha.aluno.regiao_morada, selectedAlunoFicha.aluno.setor_morada].filter(Boolean).join(' / ') || 'Não informado'}</strong></div>
                          <div><p>MORADA</p><strong>{selectedAlunoFicha.aluno.endereco_morada || 'Não informada'}</strong></div>
                          <div><p>ÚLTIMA ESCOLA</p><strong>{selectedAlunoFicha.aluno.ultima_escola_frequentada || 'Não informada'}</strong></div>
                          <div><p>CONTA</p><strong>{selectedAlunoFicha.utilizador.status_ativo ? 'Ativa' : 'Desativada'}</strong></div>
                          <div><p>TIPO DE CONTA</p><strong>{selectedAlunoFicha.utilizador.tipo_conta || 'Aluno'}</strong></div>
                          <div><p>CRIADO EM</p><strong>{selectedAlunoFicha.utilizador.criado_em ? new Date(selectedAlunoFicha.utilizador.criado_em).toLocaleDateString() : '—'}</strong></div>
                        </div>
                      </section>

                      <section>
                        <h3>Associação à escola e perfil</h3>
                        {selectedAlunoFicha.associacoes.length ? selectedAlunoFicha.associacoes.map((associacao) => (
                          <div className="modal-profile-record" key={associacao.id}>
                            <strong>{associacao.escola_nome} ({associacao.escola_sigla || 'Escola'})</strong>
                            <span>Estado: {associacao.status} · Perfil: {associacao.papeis.join(', ') || 'Sem perfil atribuído'}</span>
                          </div>
                        )) : <p>Sem associação escolar registada.</p>}
                      </section>

                      <section>
                        <h3>Encarregados de educação</h3>
                        {selectedAlunoFicha.encarregados.length ? selectedAlunoFicha.encarregados.map((encarregado) => (
                          <div className="modal-profile-record" key={encarregado.id}>
                            <strong>{encarregado.utilizador.nome} {encarregado.apelido || ''} {encarregado.contacto_principal ? '· Principal' : ''}</strong>
                            <span>{[encarregado.parentesco, encarregado.utilizador.telefone, encarregado.utilizador.email].filter(Boolean).join(' · ') || 'Sem contacto registado'}</span>
                            {encarregado.occupacao && <span>Profissão: {encarregado.occupacao}</span>}
                            {[encarregado.regiao_morada, encarregado.setor_morada, encarregado.numero_identificacao].filter(Boolean).length > 0
                              && <span>{[encarregado.regiao_morada, encarregado.setor_morada, encarregado.numero_identificacao].filter(Boolean).join(' · ')}</span>}
                          </div>
                        )) : <p>Sem encarregados associados.</p>}
                      </section>

                      <section>
                        <h3>Matrículas, polos, turmas e cursos oferecidos · {listaAnosLetivos.find((ano) => ano.id === selectedAnoLetivo)?.ano_nome || 'Todos os anos'}</h3>
                        {selectedAlunoFicha.matriculas.length ? selectedAlunoFicha.matriculas.map((matricula) => (
                          <div className="modal-profile-record" key={matricula.id}>
                            <strong>{matricula.ano_nome || 'Ano não identificado'} · {matricula.turma?.nome || 'Sem turma'} ({matricula.turma?.classe || 'Sem classe'})</strong>
                            <span>Polo: {[matricula.polo?.nome, matricula.polo?.codigo, matricula.polo?.local, matricula.polo?.telefone].filter(Boolean).join(' · ') || 'Não atribuído'} · Matrícula: {matricula.numero_matricula || 'N/D'} · Estado: {matricula.estado}</span>
                            <span>Aluno na turma: {matricula.status_aluno_turma || 'Sem registo'}{matricula.numero_chamada ? ` · Nº ${matricula.numero_chamada}` : ''}</span>
                            <span>Cursos/disciplinas: {matricula.cursos_oferecidos.map((disciplina) => [
                              disciplina.nome,
                              disciplina.codigo,
                              disciplina.carga_horaria ? `${disciplina.carga_horaria}h` : '',
                              disciplina.professor_nome,
                              disciplina.ativo ? 'Ativa' : 'Inativa'
                            ].filter(Boolean).join(' — ')).join('; ') || 'Nenhuma disciplina associada'}</span>
                            {matricula.cursos_oferecidos.some((disciplina) => disciplina.descricao)
                              && <span>Descrição: {matricula.cursos_oferecidos.filter((disciplina) => disciplina.descricao).map((disciplina) => `${disciplina.nome}: ${disciplina.descricao}`).join(' · ')}</span>}
                          </div>
                        )) : <p>Sem matrícula neste ano letivo.</p>}
                      </section>

                      <section>
                        <h3>Histórico de associação a turmas</h3>
                        {selectedAlunoFicha.alunos_turmas.length ? selectedAlunoFicha.alunos_turmas.map((ligacao) => (
                          <div className="modal-profile-record" key={ligacao.id}>
                            <strong>{ligacao.ano_nome} · {ligacao.turma.nome} ({ligacao.turma.classe || 'Sem classe'})</strong>
                            <span>Estado: {ligacao.status}{ligacao.numero_chamada ? ` · Nº ${ligacao.numero_chamada}` : ''}</span>
                          </div>
                        )) : <p>Sem histórico de turma registado.</p>}
                      </section>
                    </div>
                  )}

                  <div className="modal-footer-actions">
                    <button className="admin-btn btn-outline" onClick={() => setIsEditingProfile(true)} disabled={loadingFicha}>
                      <BsPencilSquare /> Editar Ficha do Aluno
                    </button>
                    <a href={urlNotasAluno(selectedAlunoProfile)} className="admin-btn btn-primary">
                      <BsJournalText /> Consultar Notas
                    </a>
                    <button className="admin-btn btn-outline" onClick={() => handleToggleStatus({
                      ...selectedAlunoProfile,
                      status_ativo: selectedAlunoFicha?.utilizador?.status_ativo ?? selectedAlunoProfile.status_ativo
                    })}>
                      {selectedAlunoFicha?.utilizador?.status_ativo ? <BsToggleOff /> : <BsToggleOn />}
                      {selectedAlunoFicha?.utilizador?.status_ativo ? 'Desativar conta' : 'Ativar conta'}
                    </button>
                  </div>
                </>
              ) : (
                <form onSubmit={handleSalvarEdicao} className="modal-edit-form">
                  <section className="modal-edit-section modal-edit-photo">
                    {fotoPreview ? (
                      <img src={fotoPreview} alt={`Fotografia de ${formDataEdit.nome}`} className="modal-profile-img" />
                    ) : (
                      <div className="modal-profile-fallback">
                        {(formDataEdit.nome || 'AL').substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <label className="admin-btn btn-outline modal-photo-picker" htmlFor="foto-aluno-input">
                      <BsCamera /> Carregar fotografia
                    </label>
                    <input
                      id="foto-aluno-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={selecionarFoto}
                      className="modal-photo-input"
                    />
                    <small>JPG, PNG ou WEBP · máximo 5 MB. A imagem é comprimida automaticamente.</small>
                  </section>

                  <section className="modal-edit-section">
                    <h3>Dados do aluno e da conta</h3>
                  <div className="modal-grid-2">
                    <div className="ce-field-group">
                      <label>NOME</label>
                      <input type="text" className="ce-input" value={formDataEdit.nome || ''} onChange={e => setFormDataEdit({ ...formDataEdit, nome: e.target.value })} required />
                    </div>
                    <div className="ce-field-group">
                      <label>APELIDO</label>
                      <input type="text" className="ce-input" value={formDataEdit.apelido || ''} onChange={e => setFormDataEdit({ ...formDataEdit, apelido: e.target.value })} />
                    </div>
                  </div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group">
                      <label>EMAIL</label>
                      <input type="email" className="ce-input" value={formDataEdit.email || ''} onChange={e => setFormDataEdit({ ...formDataEdit, email: e.target.value })} />
                    </div>
                    <div className="ce-field-group">
                      <label>TELEMÓVEL</label>
                      <GuineaBissauPhoneInput className="ce-input" value={formDataEdit.telefone || ''} onChange={value => setFormDataEdit(current => ({ ...current, telefone: value }))} />
                    </div>
                  </div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group">
                      <label>GÉNERO</label>
                      <select className="ce-select" value={formDataEdit.genero || ''} onChange={e => setFormDataEdit({ ...formDataEdit, genero: e.target.value })}>
                        <option value="">Não informado</option>
                        <option value="Masculino">Masculino</option>
                        <option value="Feminino">Feminino</option>
                        <option value="Outro">Outro</option>
                      </select>
                    </div>
                    <div className="ce-field-group">
                      <label>DATA DE NASCIMENTO</label>
                      <input type="date" className="ce-input" value={formDataEdit.data_nascimento || ''} onChange={e => setFormDataEdit({ ...formDataEdit, data_nascimento: e.target.value })} />
                    </div>
                  </div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group">
                      <label>NACIONALIDADE</label>
                      <input type="text" className="ce-input" value={formDataEdit.nacionalidade || ''} onChange={e => setFormDataEdit({ ...formDataEdit, nacionalidade: e.target.value })} />
                    </div>
                    <div className="ce-field-group">
                      <label>IDENTIFICAÇÃO</label>
                      <input type="text" className="ce-input" value={formDataEdit.numero_identificacao || ''} onChange={e => setFormDataEdit({ ...formDataEdit, numero_identificacao: e.target.value })} />
                    </div>
                  </div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group">
                      <label>REGIÃO DE ORIGEM</label>
                      <input type="text" className="ce-input" value={formDataEdit.regiao_origem || ''} onChange={e => setFormDataEdit({ ...formDataEdit, regiao_origem: e.target.value })} />
                    </div>
                    <div className="ce-field-group">
                      <label>LOCAL DE ORIGEM</label>
                      <input type="text" className="ce-input" value={formDataEdit.local_origem || ''} onChange={e => setFormDataEdit({ ...formDataEdit, local_origem: e.target.value })} />
                    </div>
                  </div>
                  <div className="modal-grid-2">
                    <div className="ce-field-group">
                      <label>REGIÃO DE RESIDÊNCIA</label>
                      <input type="text" className="ce-input" value={formDataEdit.regiao_morada || ''} onChange={e => setFormDataEdit({ ...formDataEdit, regiao_morada: e.target.value })} />
                    </div>
                    <div className="ce-field-group">
                      <label>SETOR DE RESIDÊNCIA</label>
                      <input type="text" className="ce-input" value={formDataEdit.setor_morada || ''} onChange={e => setFormDataEdit({ ...formDataEdit, setor_morada: e.target.value })} />
                    </div>
                  </div>
                  <div className="ce-field-group">
                    <label>ENDEREÇO / MORADA</label>
                    <input type="text" className="ce-input" value={formDataEdit.endereco_morada || ''} onChange={e => setFormDataEdit({ ...formDataEdit, endereco_morada: e.target.value })} />
                  </div>
                  <div className="ce-field-group">
                    <label>ÚLTIMA ESCOLA FREQUENTADA</label>
                    <input type="text" className="ce-input" value={formDataEdit.ultima_escola_frequentada || ''} onChange={e => setFormDataEdit({ ...formDataEdit, ultima_escola_frequentada: e.target.value })} />
                  </div>
                  <label className="modal-account-status">
                    <input type="checkbox" checked={formDataEdit.status_ativo === true} onChange={e => setFormDataEdit({ ...formDataEdit, status_ativo: e.target.checked })} />
                    Conta do aluno ativa
                  </label>
                  </section>

                  <section className="modal-edit-section">
                    <h3>Encarregados de educação</h3>
                    {formDataEdit.encarregados?.length ? formDataEdit.encarregados.map((encarregado, index) => (
                      <div className="modal-edit-guardian" key={encarregado.id}>
                        <h4>{encarregado.nome || `Encarregado ${index + 1}`}</h4>
                        <div className="modal-grid-2">
                          <div className="ce-field-group">
                            <label>NOME</label>
                            <input type="text" className="ce-input" value={encarregado.nome} onChange={e => atualizarEncarregadoEdit(index, 'nome', e.target.value)} required />
                          </div>
                          <div className="ce-field-group">
                            <label>APELIDO</label>
                            <input type="text" className="ce-input" value={encarregado.apelido} onChange={e => atualizarEncarregadoEdit(index, 'apelido', e.target.value)} />
                          </div>
                        </div>
                        <div className="modal-grid-2">
                          <div className="ce-field-group">
                            <label>PARENTESCO</label>
                            <input type="text" className="ce-input" value={encarregado.parentesco} onChange={e => atualizarEncarregadoEdit(index, 'parentesco', e.target.value)} />
                          </div>
                          <div className="ce-field-group">
                            <label>OCUPAÇÃO</label>
                            <input type="text" className="ce-input" value={encarregado.occupacao} onChange={e => atualizarEncarregadoEdit(index, 'occupacao', e.target.value)} />
                          </div>
                        </div>
                        <div className="modal-grid-2">
                          <div className="ce-field-group">
                            <label>TELEMÓVEL</label>
                            <GuineaBissauPhoneInput className="ce-input" value={encarregado.telefone} onChange={value => atualizarEncarregadoEdit(index, 'telefone', value)} />
                          </div>
                          <div className="ce-field-group">
                            <label>EMAIL</label>
                            <input type="email" className="ce-input" value={encarregado.email} onChange={e => atualizarEncarregadoEdit(index, 'email', e.target.value)} />
                          </div>
                        </div>
                        <div className="modal-grid-2">
                          <div className="ce-field-group">
                            <label>REGIÃO DE RESIDÊNCIA</label>
                            <input type="text" className="ce-input" value={encarregado.regiao_morada} onChange={e => atualizarEncarregadoEdit(index, 'regiao_morada', e.target.value)} />
                          </div>
                          <div className="ce-field-group">
                            <label>SETOR DE RESIDÊNCIA</label>
                            <input type="text" className="ce-input" value={encarregado.setor_morada} onChange={e => atualizarEncarregadoEdit(index, 'setor_morada', e.target.value)} />
                          </div>
                        </div>
                        <div className="ce-field-group">
                          <label>IDENTIFICAÇÃO</label>
                          <input type="text" className="ce-input" value={encarregado.numero_identificacao} onChange={e => atualizarEncarregadoEdit(index, 'numero_identificacao', e.target.value)} />
                        </div>
                      </div>
                    )) : <p>Este aluno ainda não tem encarregados registados.</p>}
                  </section>

                  <section className="modal-edit-section">
                    <h3>Associação, matrícula, polo, turma e cursos</h3>
                    <p>Estes dados são apresentados abaixo para conferência. A alteração de matrícula ou dos cursos oferecidos afeta a turma e deve ser feita na gestão de matrículas/turmas.</p>
                    {selectedAlunoFicha?.associacoes?.map((associacao) => (
                      <div className="modal-profile-record" key={associacao.id}>
                        <strong>{associacao.escola_nome} · {associacao.papeis.join(', ') || 'Sem perfil'}</strong>
                        <span>Associação: {associacao.status} · Conta: {selectedAlunoFicha.utilizador.login_id} · Tipo: {selectedAlunoFicha.utilizador.tipo_conta}</span>
                      </div>
                    ))}
                    {selectedAlunoFicha?.matriculas?.map((matricula) => (
                      <div className="modal-profile-record" key={matricula.id}>
                        <strong>{matricula.ano_nome} · {matricula.numero_matricula} · {matricula.estado}</strong>
                        <span>{matricula.polo?.nome || 'Sem polo'} · {matricula.turma?.nome || 'Sem turma'} ({matricula.turma?.classe || 'Sem classe'})</span>
                        <span>{matricula.cursos_oferecidos.map((disciplina) => [
                          disciplina.nome, disciplina.codigo, disciplina.carga_horaria ? `${disciplina.carga_horaria}h` : '',
                          disciplina.professor_nome
                        ].filter(Boolean).join(' — ')).join('; ') || 'Sem cursos atribuídos'}</span>
                      </div>
                    ))}
                    {selectedAlunoFicha?.alunos_turmas?.map((ligacao) => (
                      <div className="modal-profile-record" key={ligacao.id}>
                        <strong>{ligacao.ano_nome} · {ligacao.turma.nome} ({ligacao.turma.classe || 'Sem classe'})</strong>
                        <span>Inscrição: {ligacao.status}{ligacao.numero_chamada ? ` · Nº ${ligacao.numero_chamada}` : ''}</span>
                      </div>
                    ))}
                  </section>

                  <div className="modal-form-buttons">
                    <button type="button" onClick={() => {
                      setIsEditingProfile(false);
                      setFotoSelecionada(null);
                      setFotoPreview(selectedAlunoFicha?.aluno?.foto_url || '');
                    }} className="btn-cancelar" disabled={savingProfile}>Cancelar</button>
                    <button type="submit" className="admin-btn btn-primary" disabled={savingProfile}>
                      {savingProfile ? 'A guardar...' : 'Guardar Alterações'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}