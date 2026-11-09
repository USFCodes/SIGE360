'use client'; 

import React, { useState, useEffect } from 'react'; 
import { 
  BsPlusLg, BsBuilding, BsFolderPlus, BsTrash, 
  BsPencilSquare, BsPersonBadge, BsCalendarEvent, 
  BsBookmarkCheck, BsSearch, BsArrowLeft, BsDoorOpen, BsPeople 
} from 'react-icons/bs'; 
// import '@/styles/turmas-admin.css'; 

const API_URL = "http://localhost:5000/api"; 

export default function GodTurmas() { 
  const [escolas, setEscolas] = useState([]); 
  const [selectedEscola, setSelectedEscola] = useState(null); 
  const [turmas, setTurmas] = useState([]); 
  const [searchTurma, setSearchTurma] = useState(''); 
  const [searchEscola, setSearchEscola] = useState(''); 

  const [niveisDaEscola, setNiveisDaEscola] = useState([]); 
  const [anosLetivos, setAnosLetivos] = useState([]); 
  const [professores, setProfessores] = useState([]); 

  const [loading, setLoading] = useState(false); 
  const [showModal, setShowModal] = useState(false); 

  // Estado completo com TODOS os campos da tabela turmas
  const [formData, setFormData] = useState({ 
    id: null, 
    escola_id: '', 
    ano_letivo_id: '', 
    nivel_id: '', 
    nome_turma: '', 
    diretor_turma_id: '',
    turno: 'Manhã',
    sala: '',
    capacidade_maxima: 40,
    status: 'Ativo'
  }); 

  useEffect(() => { 
    carregarEscolas(); 
    carregarAnosLetivos(); 
  }, []); 

  useEffect(() => { 
    if (selectedEscola) { 
      const escolaId = selectedEscola.id_raw || selectedEscola.id; 
      carregarTurmasDaEscola(escolaId); 
      carregarProfessoresDaEscola(escolaId); 
      carregarNiveisDaEscola(selectedEscola); 
    } 
  }, [selectedEscola]); 

  const carregarEscolas = async () => { 
    try { 
      setLoading(true); 
      const res = await fetch(`${API_URL}/v1/owner/escolas?limit=100`, {
        credentials: 'include'
      }); 
      const data = await res.json(); 
      if (data.success) { 
        setEscolas(data.dados || []); 
      } 
    } catch (err) { 
      console.error('Erro ao carregar escolas:', err); 
    } finally { 
      setLoading(false); 
    } 
  }; 

  const carregarAnosLetivos = async () => { 
    try {
      const res = await fetch(`${API_URL}/v1/owner/anos-letivos`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success && data.dados.length > 0) {
        setAnosLetivos(data.dados);
      } else {
        setAnosLetivos([{ id: 1, ano_nome: '2026/2027' }]);
      }
    } catch (err) {
      setAnosLetivos([{ id: 1, ano_nome: '2026/2027' }]);
    }
  }; 

  const carregarNiveisDaEscola = (escola) => { 
    const mapaNiveis = { 
      1: [{ id: 1, nome: 'Jardim de Infância / Infantil' }], 
      2: [{ id: 2, nome: 'Ensino Básico (1º Ciclo)' }], 
      3: [{ id: 3, nome: 'Ensino Básico (2º Ciclo)' }], 
      4: [{ id: 4, nome: 'Ensino Básico (3º Ciclo)' }], 
      5: [{ id: 5, nome: 'Ensino Secundário / Liceu' }], 
      6: [{ id: 6, nome: 'Formação Técnico-Profissional' }], 
      7: [{ id: 7, nome: 'Ensino Superior / Universidade' }] 
    }; 
    const nivelKey = Number(escola.nivel) || 4; 
    setNiveisDaEscola(mapaNiveis[nivelKey] || [ 
      { id: 1, nome: 'Jardim de Infância' }, 
      { id: 2, nome: 'Ensino Básico' }, 
      { id: 3, nome: 'Ensino Básico (2º Ciclo)' }, 
      { id: 4, nome: 'Ensino Básico (3º Ciclo)' }, 
      { id: 5, nome: 'Ensino Secundário' } 
    ]); 
  }; 

  const carregarTurmasDaEscola = async (escolaId) => { 
    try { 
      const res = await fetch(`${API_URL}/v1/owner/escolas/${escolaId}/turmas`, {
        credentials: 'include'
      }); 
      const data = await res.json(); 
      if (data.success) { 
        setTurmas(data.dados || []); 
      } else { 
        setTurmas([]); 
      } 
    } catch (err) { 
      console.error('Erro ao carregar turmas:', err); 
      setTurmas([]); 
    } 
  }; 

  const carregarProfessoresDaEscola = async (escolaId) => { 
    try { 
      const res = await fetch(`${API_URL}/v1/owner/escolas/${escolaId}/utilizadores`, {
        credentials: 'include'
      }); 
      const data = await res.json(); 
      if (data.success) { 
        // Filtra utilizadores com perfil_id = 6 (Professores) ou lista todos
        const listaProfessores = data.dados.filter(u => String(u.perfil_id) === '6' || u.cargo?.toLowerCase().includes('prof'));
        setProfessores(listaProfessores.length > 0 ? listaProfessores : data.dados); 
      } 
    } catch (err) { 
      console.error('Erro ao carregar professores:', err); 
    } 
  }; 

  const handleOpenAddModal = () => { 
    const escolaId = selectedEscola.id_raw || selectedEscola.id; 
    setFormData({ 
      id: null, 
      escola_id: escolaId, 
      ano_letivo_id: anosLetivos[0]?.id || 1, 
      nivel_id: niveisDaEscola[0]?.id || 1, 
      nome_turma: '', 
      diretor_turma_id: '',
      turno: 'Manhã',
      sala: '',
      capacidade_maxima: 40,
      status: 'Ativo'
    }); 
    setShowModal(true); 
  }; 

  const handleOpenEditModal = (turma) => {
    setFormData({
      id: turma.id,
      escola_id: turma.escola_id || (selectedEscola.id_raw || selectedEscola.id),
      ano_letivo_id: turma.ano_letivo_id || anosLetivos[0]?.id || 1,
      nivel_id: turma.nivel_id || niveisDaEscola[0]?.id || 1,
      nome_turma: turma.nome_turma || '',
      diretor_turma_id: turma.diretor_turma_id || '',
      turno: turma.turno || 'Manhã',
      sala: turma.sala || '',
      capacidade_maxima: turma.capacidade_maxima || 40,
      status: turma.status || 'Ativo'
    });
    setShowModal(true);
  };

  const handleSaveTurma = async (e) => { 
    e.preventDefault(); 
    if (!formData.nome_turma || !formData.escola_id) { 
      alert('Preencha o nome da turma.'); 
      return; 
    } 

    try { 
      const isEditing = Boolean(formData.id);
      const endpoint = isEditing 
        ? `${API_URL}/v1/owner/turmas/${formData.id}` 
        : `${API_URL}/v1/owner/escolas/${formData.escola_id}/turmas`; 

      const method = isEditing ? 'PUT' : 'POST'; 

      const res = await fetch(endpoint, { 
        method, 
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ano_letivo_id: formData.ano_letivo_id, 
          nivel_id: formData.nivel_id, 
          nome_turma: formData.nome_turma, 
          diretor_turma_id: formData.diretor_turma_id || null,
          turno: formData.turno,
          sala: formData.sala,
          capacidade_maxima: formData.capacidade_maxima,
          status: formData.status
        }) 
      }); 

      const data = await res.json(); 
      if (data.success) { 
        alert(isEditing ? 'Turma atualizada!' : 'Turma criada com sucesso!'); 
        setShowModal(false); 
        carregarTurmasDaEscola(selectedEscola.id_raw || selectedEscola.id); 
      } else { 
        alert('Erro: ' + data.message); 
      } 
    } catch (err) { 
      alert('Erro ao guardar turma no servidor.'); 
    } 
  }; 

  const handleDeleteTurma = async (id, nome) => { 
    if (confirm(`Deseja desativar a turma "${nome}"?`)) { 
      try { 
        const res = await fetch(`${API_URL}/v1/owner/turmas/${id}/status`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Inativo' }) 
        }); 
        const data = await res.json(); 
        if (data.success) { 
          carregarTurmasDaEscola(selectedEscola.id_raw || selectedEscola.id); 
        } else { 
          alert('Erro: ' + data.message); 
        } 
      } catch (err) { 
        alert('Erro ao alterar estado da turma.'); 
      } 
    } 
  }; 

  const escolasFiltradas = escolas.filter(e => 
    e.nome.toLowerCase().includes(searchEscola.toLowerCase()) || 
    e.sigla.toLowerCase().includes(searchEscola.toLowerCase()) 
  ); 

  const turmasFiltradas = turmas.filter(t => 
    t.nome_turma.toLowerCase().includes(searchTurma.toLowerCase()) 
  ); 

  return ( 
    <div className="turmas-page-container"> 
      {/* HEADER HERO */} 
      <header className="escolas-header-hero"> 
        <div className="escolas-hero-text"> 
          <h1>PAINEL DE GESTÃO DE TURMAS</h1> 
          <p>Selecione uma unidade escolar abaixo para gerir classes, níveis e diretores de turma</p> 
        </div> 
      </header> 

      <div className="turmas-main-wrapper"> 
        {!selectedEscola ? ( 
          /* VISTA 1: GRELLHA DE ESCOLAS */ 
          <div className="escolas-grid-selection-view"> 
            <div className="selection-view-header"> 
              <h3>Escolha a Unidade Escolar</h3> 
              <div className="escolas-search-input-wrapper"> 
                <BsSearch className="search-icon" /> 
                <input 
                  type="text" 
                  placeholder="Filtrar escolas por nome ou sigla..." 
                  value={searchEscola} 
                  onChange={(e) => setSearchEscola(e.target.value)} 
                /> 
              </div> 
            </div> 

            {loading ? ( 
              <p className="loading-text">A carregar escolas...</p> 
            ) : ( 
              <div className="escolas-selection-grid"> 
                {escolasFiltradas.map((esc) => { 
                  const escId = esc.id_raw || esc.id; 
                  return ( 
                    <div 
                      key={escId} 
                      className="escola-grid-card-item" 
                      onClick={() => setSelectedEscola(esc)} 
                    > 
                      <div className="escola-grid-card-avatar" style={{ background: esc.corPrimaria || '#0284c7' }}> 
                        {esc.sigla} 
                      </div> 
                      <div className="escola-grid-card-body"> 
                        <h4>{esc.nome}</h4> 
                        <p><BsBuilding /> {esc.local || 'Guiné-Bissau'} · Ref: #{esc.id}</p> 
                      </div> 
                      <div className="escola-grid-card-arrow"> 
                        Gerir Turmas → 
                      </div> 
                    </div> 
                  ); 
                })} 
              </div> 
            )} 
          </div> 
        ) : ( 
          /* VISTA 2: TURMAS DA ESCOLA */ 
          <div className="escolas-turmas-management-view"> 
            <div className="management-top-bar"> 
              <button className="btn-back-to-schools" onClick={() => setSelectedEscola(null)}> 
                <BsArrowLeft /> Voltar às Escolas 
              </button> 
              <div className="selected-school-badge-info"> 
                <span className="badge-sigla" style={{ background: selectedEscola.corPrimaria || '#0284c7' }}> 
                  {selectedEscola.sigla} 
                </span> 
                <div> 
                  <h2>{selectedEscola.nome}</h2> 
                  <p>Nível Institucional Autorizado: <strong>Nível {selectedEscola.nivel || 4}</strong></p> 
                </div> 
              </div> 
              <button onClick={handleOpenAddModal} className="btn-hero-action primary"> 
                <BsPlusLg /> Criar Nova Turma 
              </button> 
            </div> 

            <div className="turmas-content-card"> 
              <div className="turmas-top-header"> 
                <div> 
                  <h3>Turmas Registadas ({turmasFiltradas.length})</h3> 
                  <span>Classes configuradas na instituição</span> 
                </div> 
                <div className="escolas-search-input-wrapper"> 
                  <BsSearch className="search-icon" /> 
                  <input 
                    type="text" 
                    placeholder="Pesquisar turma..." 
                    value={searchTurma} 
                    onChange={(e) => setSearchTurma(e.target.value)} 
                  /> 
                </div> 
              </div> 

              {turmasFiltradas.length > 0 ? ( 
                <div className="turmas-grid-cards"> 
                  {turmasFiltradas.map((turma) => { 
                    const nivelObj = niveisDaEscola.find(n => n.id === Number(turma.nivel_id)); 
                    const anoObj = anosLetivos.find(a => a.id === Number(turma.ano_letivo_id)); 
                    
                    return ( 
                      <div key={turma.id} className="turma-item-box"> 
                        <div className="turma-box-head"> 
                          <div> 
                            <h3>{turma.nome_turma}</h3> 
                            <span className="turma-id-badge">ID: #{turma.id}</span> 
                          </div> 
                          <div className="action-buttons-group"> 
                            <button className="btn-tb-act edit" onClick={() => handleOpenEditModal(turma)}> 
                              <BsPencilSquare /> 
                            </button> 
                            <button className="btn-tb-act delete" onClick={() => handleDeleteTurma(turma.id, turma.nome_turma)}> 
                              <BsTrash /> 
                            </button> 
                          </div> 
                        </div> 
                        <div className="turma-box-details"> 
                          <p><BsBookmarkCheck /> Nível: <strong>{turma.nivel_nome || nivelObj?.nome || 'Ensino Geral'}</strong></p> 
                          <p><BsCalendarEvent /> Ano Letivo: <strong>{turma.ano_nome || anoObj?.ano_nome || '2026/2027'}</strong></p> 
                          <p><BsPersonBadge /> Diretor: <strong>{turma.diretor_turma_nome || turma.diretor_turma_id || 'Não Atribuído'}</strong></p> 
                          <p><BsDoorOpen /> Turno / Sala: <strong>{turma.turno || 'Manhã'} ({turma.sala || 'Sem Sala'})</strong></p>
                          <p><BsPeople /> Lotação: <strong>{turma.capacidade_maxima || 40} Alunos</strong></p>
                        </div> 
                      </div> 
                    ); 
                  })} 
                </div> 
              ) : ( 
                <div className="empty-turmas-state"> 
                  Nenhuma turma registada nesta escola. Clique em &quot;Criar Nova Turma&quot; para começar. 
                </div> 
              )} 
            </div> 
          </div> 
        )} 
      </div> 

      {/* MODAL COMPLETO COM TODOS OS CAMPOS DA BASE DE DADOS */} 
      {showModal && ( 
        <div className="modal-admin-overlay" onClick={() => setShowModal(false)}> 
          <div className="modal-admin-box" onClick={(e) => e.stopPropagation()}> 
            <div className="modal-admin-header"> 
              <h2>{formData.id ? 'EDITAR REGISTO DA TURMA' : `NOVA TURMA · ${selectedEscola?.sigla}`}</h2> 
              <button className="btn-modal-close" onClick={() => setShowModal(false)}>✕</button> 
            </div> 

            <form onSubmit={handleSaveTurma} className="modal-admin-body"> 
              
              <div className="ce-field-group"> 
                <label>NOME DA TURMA *</label> 
                <input 
                  type="text" 
                  placeholder="Ex: 10º Ano Ciências A" 
                  className="ce-input" 
                  value={formData.nome_turma} 
                  onChange={(e) => setFormData({ ...formData, nome_turma: e.target.value })} 
                  required 
                /> 
              </div> 

              <div className="modal-grid-2"> 
                <div className="ce-field-group"> 
                  <label>NÍVEL DE ENSINO</label> 
                  <select 
                    className="ce-select" 
                    value={formData.nivel_id} 
                    onChange={(e) => setFormData({ ...formData, nivel_id: Number(e.target.value) })} 
                    required 
                  > 
                    {niveisDaEscola.map(n => ( 
                      <option key={n.id} value={n.id}>{n.nome}</option> 
                    ))} 
                  </select> 
                </div> 

                <div className="ce-field-group"> 
                  <label>ANO LETIVO</label> 
                  <select 
                    className="ce-select" 
                    value={formData.ano_letivo_id} 
                    onChange={(e) => setFormData({ ...formData, ano_letivo_id: Number(e.target.value) })} 
                  > 
                    {anosLetivos.map(a => ( 
                      <option key={a.id} value={a.id}>{a.ano_nome}</option> 
                    ))} 
                  </select> 
                </div> 
              </div> 

              <div className="ce-field-group"> 
                <label>DIRETOR DE TURMA / PROFESSOR (Perfil nº 6)</label> 
                <select 
                  className="ce-select" 
                  value={formData.diretor_turma_id || ''} 
                  onChange={(e) => setFormData({ ...formData, diretor_turma_id: e.target.value })} 
                > 
                  <option value="">-- Selecione o Diretor de Turma (Opcional) --</option> 
                  {professores.map(p => ( 
                    <option key={p.utilizador_id || p.id} value={p.utilizador_id || p.id}> 
                      {p.nome} ({p.email || 'Professor'}) 
                    </option> 
                  ))} 
                </select> 
              </div> 

              <div className="modal-grid-2">
                <div className="ce-field-group"> 
                  <label>TURNO</label> 
                  <select 
                    className="ce-select" 
                    value={formData.turno} 
                    onChange={(e) => setFormData({ ...formData, turno: e.target.value })} 
                  > 
                    <option value="Manhã">Manhã</option> 
                    <option value="Tarde">Tarde</option> 
                    <option value="Noite">Noite</option> 
                    <option value="Integral">Integral</option> 
                  </select> 
                </div> 

                <div className="ce-field-group"> 
                  <label>SALA DE AULA</label> 
                  <input 
                    type="text" 
                    placeholder="Ex: Sala 04 / Bloco B" 
                    className="ce-input" 
                    value={formData.sala} 
                    onChange={(e) => setFormData({ ...formData, sala: e.target.value })} 
                  /> 
                </div> 
              </div>

              <div className="modal-grid-2">
                <div className="ce-field-group"> 
                  <label>CAPACIDADE MÁXIMA</label> 
                  <input 
                    type="number" 
                    className="ce-input" 
                    value={formData.capacidade_maxima} 
                    onChange={(e) => setFormData({ ...formData, capacidade_maxima: Number(e.target.value) })} 
                  /> 
                </div> 

                <div className="ce-field-group"> 
                  <label>ESTADO DA TURMA</label> 
                  <select 
                    className="ce-select" 
                    value={formData.status} 
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })} 
                  > 
                    <option value="Ativo">Ativo</option> 
                    <option value="Inativo">Inativo</option> 
                  </select> 
                </div> 
              </div>

              <div className="modal-footer-actions"> 
                <button type="button" onClick={() => setShowModal(false)} className="ce-btn-back"> 
                  Cancelar 
                </button> 
                <button type="submit" className="btn-print-official"> 
                  Guardar Turma 
                </button> 
              </div> 
            </form> 
          </div> 
        </div> 
      )} 
    </div> 
  ); 
}