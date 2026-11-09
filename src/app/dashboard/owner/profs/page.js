'use client'; 

import React, { useState, useEffect } from 'react'; 
import GuineaBissauPhoneInput from '@/components/GuineaBissauPhoneInput';
// import '../../../../styles/adm-profs.css';

export default function GodProfs() { 
  const escolaId = 1; 
  const API = 'http://localhost:5000'; 

  const [abaAtiva, setAbaAtiva] = useState('professores'); 
  const [professores, setProfessores] = useState([]); 
  const [disciplinas, setDisciplinas] = useState([]); 
  const [turmas, setTurmas] = useState([]); 
  const [mensagem, setMensagem] = useState({ texto: '', tipo: '' }); 

  // Formulário Professor 
  const [formProf, setFormProf] = useState({ 
    professor_custom_id: '', 
    nome: '', 
    email: '', 
    telefone: '', 
    tipo_cargo: 'Professor de Disciplina', 
    especialidade: '', 
    turma_id_dirigida: '' 
  }); 

  // Formulário Disciplina 
  const [formDisc, setFormDisc] = useState({ nome: '', codigo: '', tipo: 'Geral' }); 
  const [disciplinaEmEdicao, setDisciplinaEmEdicao] = useState(null); 
  const [vinculo, setVinculo] = useState({ professor_id: '', turma_id: '', disciplina_id: '' }); 

  useEffect(() => { 
    carregarDados(); 
  }, []); 

  async function carregarDados() { 
    try { 
      const [resProf, resDisc, resId, resTurmas] = await Promise.all([ 
        fetch(`${API}/v1/owner/escolas/${escolaId}/professores`), 
        fetch(`${API}/v1/owner/escolas/${escolaId}/disciplinas`), 
        fetch(`${API}/v1/owner/escolas/${escolaId}/gerar-id-professor`), 
        fetch(`${API}/v1/owner/escolas/${escolaId}/turmas`).catch(() => ({ json: () => ({ success: false, dados: [] }) })) 
      ]); 

      const dataProf = await resProf.json(); 
      const dataDisc = await resDisc.json(); 
      const dataId = await resId.json(); 
      const dataTurmas = await resTurmas.json(); 

      if (dataProf.success) setProfessores(dataProf.dados || []); 
      if (dataDisc.success) setDisciplinas(dataDisc.dados || []); 
      if (dataId.success) setFormProf(p => ({ ...p, professor_custom_id: dataId.professor_id })); 
      if (dataTurmas.success) setTurmas(dataTurmas.dados || []); 
    } catch (error) { 
      console.error('Erro ao carregar dados:', error); 
    } 
  } 

  async function handleSalvarProfessor(e) { 
    e.preventDefault(); 
    try { 
      const res = await fetch(`${API}/v1/owner/escolas/${escolaId}/professores`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(formProf) 
      }); 
      const data = await res.json(); 

      if (data.success) { 
        setMensagem({ texto: data.message, tipo: 'sucesso' }); 
        carregarDados(); 
        const resId = await fetch(`${API}/v1/owner/escolas/${escolaId}/gerar-id-professor`); 
        const dataId = await resId.json(); 
        setFormProf({ 
          professor_custom_id: dataId.success ? dataId.professor_id : '', 
          nome: '', 
          email: '', 
          telefone: '', 
          tipo_cargo: 'Professor de Disciplina', 
          especialidade: '', 
          turma_id_dirigida: '' 
        }); 
      } else { 
        setMensagem({ texto: data.message, tipo: 'erro' }); 
      } 
    } catch { 
      setMensagem({ texto: 'Erro interno ao guardar professor.', tipo: 'erro' }); 
    } 
  } 

  async function handleSalvarDisciplina(e) { 
    e.preventDefault(); 
    const endpoint = disciplinaEmEdicao 
      ? `${API}/v1/owner/disciplinas/${disciplinaEmEdicao}` 
      : `${API}/v1/owner/escolas/${escolaId}/disciplinas`; 

    try { 
      const res = await fetch(endpoint, { 
        method: disciplinaEmEdicao ? 'PUT' : 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(formDisc) 
      }); 
      const data = await res.json(); 

      if (data.success) { 
        setMensagem({ texto: data.message, tipo: 'sucesso' }); 
        setDisciplinaEmEdicao(null); 
        setFormDisc({ nome: '', codigo: '', tipo: 'Geral' }); 
        carregarDados(); 
      } else { 
        setMensagem({ texto: data.message, tipo: 'erro' }); 
      } 
    } catch { 
      setMensagem({ texto: 'Erro ao guardar disciplina.', tipo: 'erro' }); 
    } 
  } 

  async function handleVincular(e) { 
    e.preventDefault(); 
    try { 
      const res = await fetch(`${API}/v1/owner/escolas/${escolaId}/professores/vincular-disciplina`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(vinculo) 
      }); 
      const data = await res.json(); 
      setMensagem({ texto: data.message, tipo: data.success ? 'sucesso' : 'erro' }); 
    } catch { 
      setMensagem({ texto: 'Erro ao efetuar associação.', tipo: 'erro' }); 
    } 
  } 

  async function handleToggleStatus(professorId, statusAtual) { 
    try { 
      const res = await fetch(`${API}/v1/owner/professores/${professorId}/status`, { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ ativo: !statusAtual }) 
      }); 
      const data = await res.json(); 
      if (data.success) carregarDados(); 
    } catch (error) { 
      console.error('Erro ao alterar status:', error); 
    } 
  } 

  return ( 
    <div className="adm-container"> 
      <h1 className="adm-title">Gestão de Professores e Disciplinas</h1> 

      {mensagem.texto && ( 
        <div className={`adm-alert ${mensagem.tipo === 'sucesso' ? 'adm-alert-sucesso' : 'adm-alert-erro'}`}> 
          <span>{mensagem.texto}</span> 
          <button onClick={() => setMensagem({ texto: '', tipo: '' })} className="adm-alert-close">&times;</button> 
        </div> 
      )} 

      <div className="adm-tabs"> 
        <button onClick={() => setAbaAtiva('professores')} className={`adm-tab-btn ${abaAtiva === 'professores' ? 'active' : ''}`}> 
          Professores 
        </button> 
        <button onClick={() => setAbaAtiva('disciplinas')} className={`adm-tab-btn ${abaAtiva === 'disciplinas' ? 'active' : ''}`}> 
          Disciplinas 
        </button> 
        <button onClick={() => setAbaAtiva('vinculacao')} className={`adm-tab-btn ${abaAtiva === 'vinculacao' ? 'active' : ''}`}> 
          Associação (Turmas & Salas) 
        </button> 
      </div> 

      {abaAtiva === 'professores' && ( 
        <div className="adm-grid-2"> 
          <div className="adm-card"> 
            <h2 className="adm-card-title">Cadastrar Professor</h2> 
            <form onSubmit={handleSalvarProfessor}> 
              <div className="adm-form-group"> 
                <label className="adm-label">ID Automático</label> 
                <input type="text" value={formProf.professor_custom_id} disabled className="adm-input" /> 
              </div> 
              <div className="adm-form-group"> 
                <label className="adm-label">Nome Completo</label> 
                <input type="text" required value={formProf.nome} onChange={e => setFormProf({...formProf, nome: e.target.value})} className="adm-input" placeholder="Insira o nome..." /> 
              </div> 
              <div className="adm-form-group"> 
                <label className="adm-label">Email</label> 
                <input type="email" required value={formProf.email} onChange={e => setFormProf({...formProf, email: e.target.value})} className="adm-input" placeholder="email@escola.com" /> 
              </div> 
              <div className="adm-form-group"> 
                <label className="adm-label">Telefone</label> 
                <GuineaBissauPhoneInput required value={formProf.telefone} onChange={value => setFormProf(current => ({ ...current, telefone: value }))} className="adm-input" placeholder="+245 ..." />
              </div> 
              <div className="adm-form-group"> 
                <label className="adm-label">Cargo / Papel</label> 
                <select value={formProf.tipo_cargo} onChange={e => setFormProf({...formProf, tipo_cargo: e.target.value})} className="adm-select"> 
                  <option value="Professor de Disciplina">Professor de Disciplina</option> 
                  <option value="Professor Titular (Ensino Básico / Sala Única)">Professor Titular (Sala Única)</option> 
                  <option value="Diretor de Turma">Diretor de Turma</option> 
                </select> 
              </div> 
              <div className="adm-form-group"> 
                <label className="adm-label">Especialidade</label> 
                <input type="text" value={formProf.especialidade} onChange={e => setFormProf({...formProf, especialidade: e.target.value})} className="adm-input" placeholder="Ex: Matemática" /> 
              </div> 
              <button type="submit" className="adm-btn-primary">Registar Professor</button> 
            </form> 
          </div> 

          <div className="adm-card adm-table-container"> 
            <h2 className="adm-card-title">Professores Registados</h2> 
            <table className="adm-table">
              <thead><tr>
                <th>ID</th>
                <th>Nome</th>
                <th>Cargo</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th>Ações</th>
              </tr></thead>
              <tbody> 
                {professores.map(p => ( 
                  <tr key={p.professor_id}> 
                    <td><span className="adm-text-id">{p.professor_id}</span></td> 
                    <td style={{fontWeight: 500}}>{p.nome}</td> 
                    <td><span className="adm-badge-cargo">{p.cargo}</span></td> 
                    <td style={{fontSize: '0.825rem', color: '#64748b'}}>{p.telefone}<br/>{p.email}</td> 
                    <td> 
                      <span className={`adm-badge-ativo ${p.ativo}`}> 
                        {p.ativo ? 'Ativo' : 'Suspenso'} 
                      </span> 
                    </td> 
                    <td> 
                      <button onClick={() => handleToggleStatus(p.professor_id, p.ativo)} className={`adm-btn-status ${p.ativo ? 'suspender' : 'ativar'}`}> 
                        {p.ativo ? 'Suspender' : 'Ativar'} 
                      </button> 
                    </td> 
                  </tr> 
                ))} 
              </tbody> 
            </table> 
          </div> 
        </div> 
      )} 

      {abaAtiva === 'disciplinas' && ( 
        <div className="adm-grid-2"> 
          <div className="adm-card"> 
            <h2 className="adm-card-title">{disciplinaEmEdicao ? 'Editar Disciplina' : 'Nova Disciplina'}</h2> 
            <form onSubmit={handleSalvarDisciplina}> 
              <div className="adm-form-group"> 
                <label className="adm-label">Nome</label> 
                <input type="text" required value={formDisc.nome} onChange={e => setFormDisc({...formDisc, nome: e.target.value})} className="adm-input" placeholder="Ex: Matemática" /> 
              </div> 
              <div className="adm-form-group"> 
                <label className="adm-label">Código</label> 
                <input type="text" value={formDisc.codigo} onChange={e => setFormDisc({...formDisc, codigo: e.target.value})} className="adm-input" placeholder="Ex: MAT101" /> 
              </div> 
              <div className="adm-form-group"> 
                <label className="adm-label">Tipo</label> 
                <select value={formDisc.tipo} onChange={e => setFormDisc({...formDisc, tipo: e.target.value})} className="adm-select"> 
                  <option value="Geral">Geral</option> 
                  <option value="Específica">Específica</option> 
                </select> 
              </div> 
              <button type="submit" className="adm-btn-primary"> 
                {disciplinaEmEdicao ? 'Atualizar Disciplina' : 'Criar Disciplina'} 
              </button> 
              {disciplinaEmEdicao && ( 
                <button type="button" onClick={() => { setDisciplinaEmEdicao(null); setFormDisc({nome:'', codigo:'', tipo:'Geral'}); }} className="adm-btn-secondary"> 
                  Cancelar 
                </button> 
              )} 
            </form> 
          </div> 

          <div className="adm-card adm-table-container"> 
            <h2 className="adm-card-title">Disciplinas da Escola (Política de Não Exclusão)</h2> 
            <table className="adm-table">
              <thead><tr>
                <th>Nome</th>
                <th>Código</th>
                <th>Tipo</th>
                <th>Ações</th>
              </tr></thead>
              <tbody> 
                {disciplinas.map(d => ( 
                  <tr key={d.id}> 
                    <td style={{fontWeight: 500}}>{d.nome}</td> 
                    <td><span className="adm-text-id">{d.codigo || 'N/D'}</span></td> 
                    <td>{d.tipo}</td> 
                    <td> 
                      <button onClick={() => { setDisciplinaEmEdicao(d.id); setFormDisc({nome: d.nome, codigo: d.codigo || '', tipo: d.tipo}); }} className="adm-action-link"> 
                        Editar 
                      </button> 
                    </td> 
                  </tr> 
                ))} 
              </tbody> 
            </table> 
          </div> 
        </div> 
      )} 

      {abaAtiva === 'vinculacao' && ( 
        <div className="adm-card" style={{ maxWidth: '42rem', margin: '0 auto' }}> 
          <h2 className="adm-card-title">Vincular Professor a Turma e Disciplina</h2> 
          <p style={{fontSize: '0.875rem', color: '#64748b', marginBottom: '1.25rem'}}> 
            Para professores do ensino básico (sala única), deixe o campo de disciplina vazio. 
          </p> 
          <form onSubmit={handleVincular}> 
            <div className="adm-form-group"> 
              <label className="adm-label">Professor</label> 
              <select required onChange={e => setVinculo({...vinculo, professor_id: e.target.value})} className="adm-select"> 
                <option value="">Selecione o professor...</option> 
                {professores.map(p => ( 
                  <option key={p.professor_id} value={p.professor_id}>{p.nome} ({p.professor_id})</option> 
                ))} 
              </select> 
            </div> 
            <div className="adm-form-group"> 
              <label className="adm-label">Turma</label> 
              <select required onChange={e => setVinculo({...vinculo, turma_id: e.target.value})} className="adm-select"> 
                <option value="">Selecione a turma...</option> 
                {turmas.map(t => ( 
                  <option key={t.id} value={t.id}>{t.nome_turma}</option> 
                ))} 
              </select> 
            </div> 
            <div className="adm-form-group"> 
              <label className="adm-label">Disciplina (Opcional para Salas Únicas)</label> 
              <select onChange={e => setVinculo({...vinculo, disciplina_id: e.target.value})} className="adm-select"> 
                <option value="">Nenhuma (Professor Titular / Sala Única)</option> 
                {disciplinas.map(d => ( 
                  <option key={d.id} value={d.id}>{d.nome}</option> 
                ))} 
              </select> 
            </div> 
            <button type="submit" className="adm-btn-primary">Efetuar Associação</button> 
          </form> 
        </div> 
      )} 
    </div> 
  ); 
}