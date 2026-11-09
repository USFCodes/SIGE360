'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BsCheckCircleFill, BsJournalText, BsSearch, BsShieldCheck } from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';
import '@/styles/s3.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_TESOURARIA = `${API_BASE}/api/v1/tesouraria`;
const API_ESCOLAS = `${API_BASE}/api/v1/escolas`;
const API_AUTH = `${API_BASE}/api/v1/auth`;

async function lerRespostaApi(response) {
  const texto = await response.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`A API respondeu com conteúdo inválido (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Falha no pedido à API (HTTP ${response.status}).`);
  }
  return data;
}

function formatarMoeda(valor) {
  return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(Number(valor) || 0)} CFA`;
}

function paraCentimos(valor) {
  const montante = Number(valor) || 0;
  return Math.round(montante * 100);
}

function ordenarAnosLetivos(anos) {
  return [...anos].sort((a, b) => {
    if (Boolean(a.ativo) !== Boolean(b.ativo)) return a.ativo ? -1 : 1;
    return String(b.data_inicio || '').localeCompare(String(a.data_inicio || '')) ||
      String(a.ano_nome || '').localeCompare(String(b.ano_nome || ''), 'pt');
  });
}

export default function RegistarPagamentoSecretaria({ escolaIdProp }) {
  const [anosLetivos, setAnosLetivos] = useState([]);
  const [anoLetivoId, setAnoLetivoId] = useState('');
  const [itensPagamento, setItensPagamento] = useState([]);
  const [classes, setClasses] = useState([]);
  const [classeSelecionada, setClasseSelecionada] = useState('');
  const [carregandoDados, setCarregandoDados] = useState(true);

  const [idTalaoInput, setIdTalaoInput] = useState('');
  const [talaoConfirmado, setTalaoConfirmado] = useState(null);
  const [aValidarTalao, setAValidarTalao] = useState(false);
  const [termoPesquisaAluno, setTermoPesquisaAluno] = useState('');
  const [resultadosAlunos, setResultadosAlunos] = useState({ termo: '', alunos: [] });
  const [pesquisandoAlunos, setPesquisandoAlunos] = useState(false);
  const [alunoSelecionado, setAlunoSelecionado] = useState(null);
  const [valoresAlocacao, setValoresAlocacao] = useState({});
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const carregarDadosDoBackend = async () => {
      try {
        let escolaIdAtual = escolaIdProp || '';
        if (!escolaIdAtual) {
          const sessaoRes = await fetch(`${API_AUTH}/me`, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
          });
          const sessaoData = await lerRespostaApi(sessaoRes);
          escolaIdAtual = sessaoData.data?.conta_ativa?.escola_id || '';
        }
        if (!escolaIdAtual) throw new Error('Escola ativa não identificada.');

        const [resAnos, resItens, resTurmas] = await Promise.all([
          fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(escolaIdAtual)}/anos-letivos`, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
          }),
          fetch(`${API_TESOURARIA}/propinas-taxas`, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
          }),
          fetch(`${API_TESOURARIA}/turmas`, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
          })
        ]);
        const [dataAnos, dataItens, dataTurmas] = await Promise.all([
          lerRespostaApi(resAnos),
          lerRespostaApi(resItens),
          lerRespostaApi(resTurmas)
        ]);

        const anos = ordenarAnosLetivos(Array.isArray(dataAnos.dados) ? dataAnos.dados : []);
        const itens = Array.isArray(dataItens.dados) ? dataItens.dados : [];
        const listaClasses = [...new Set((Array.isArray(dataTurmas.dados) ? dataTurmas.dados : [])
          .map((turma) => turma.classe)
          .filter((classe) => typeof classe === 'string' && classe.trim()))]
          .sort((a, b) => a.localeCompare(b, 'pt'));
        setAnosLetivos(anos);
        setItensPagamento(itens);
        setClasses(listaClasses);
        const anoAtivo = anos.find((ano) => ano.ativo) || anos[0];
        if (anoAtivo) setAnoLetivoId(String(anoAtivo.ano_letivo_id || anoAtivo.id));
        if (listaClasses.length) setClasseSelecionada(listaClasses[0]);
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMsg(error.message || 'Não foi possível carregar os dados da escola.');
        }
      } finally {
        if (!controller.signal.aborted) setCarregandoDados(false);
      }
    };
    void carregarDadosDoBackend();
    return () => controller.abort();
  }, [escolaIdProp]);

  useEffect(() => {
    const termo = termoPesquisaAluno.trim();
    if (!talaoConfirmado || termo.length < 2) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setPesquisandoAlunos(true);
        const query = new URLSearchParams({
          ano_letivo_id: anoLetivoId,
          classe: classeSelecionada,
          busca: termo
        });
        const response = await fetch(`${API_TESOURARIA}/pagamentos/talao-alunos?${query}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        });
        const data = await lerRespostaApi(response);
        if (!controller.signal.aborted) {
          setResultadosAlunos({ termo, alunos: Array.isArray(data.dados) ? data.dados : [] });
        }
      } catch (error) {
        if (!controller.signal.aborted) setErrorMsg(error.message || 'Não foi possível pesquisar alunos.');
      } finally {
        if (!controller.signal.aborted) setPesquisandoAlunos(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [anoLetivoId, classeSelecionada, talaoConfirmado, termoPesquisaAluno]);

  const itensDisponiveisNaClasse = useMemo(() => itensPagamento.filter((item) =>
    item.classe_precos?.some((preco) =>
      String(preco.classe).toLowerCase() === classeSelecionada.toLowerCase() &&
      String(preco.ano_letivo_id) === anoLetivoId
    )
  ), [anoLetivoId, itensPagamento, classeSelecionada]);
  const itensDoAluno = itensDisponiveisNaClasse.filter((item) =>
    !item.nivel_ids?.length ||
    (alunoSelecionado?.nivel_id && item.nivel_ids.includes(alunoSelecionado.nivel_id))
  );

  const anoSelecionado = anosLetivos.find((ano) =>
    String(ano.ano_letivo_id || ano.id) === String(anoLetivoId)
  );
  const classeValida = classes.includes(classeSelecionada);
  const alocacoes = itensDoAluno
    .map((item) => ({
      propina_taxa_id: item.id,
      valor: Number(valoresAlocacao[item.id]) || 0
    }))
    .filter((alocacao) => alocacao.valor > 0);
  const totalAlocadoCentimos = alocacoes.reduce((total, item) => total + paraCentimos(item.valor), 0);
  const valorTalaoCentimos = paraCentimos(talaoConfirmado?.valor);
  const diferencaCentimos = valorTalaoCentimos - totalAlocadoCentimos;
  const alunosFiltrados = resultadosAlunos.termo === termoPesquisaAluno.trim()
    ? resultadosAlunos.alunos
    : [];

  const confirmarTalaoTesouraria = async (event) => {
    event.preventDefault();
    const codigo = idTalaoInput.trim().toUpperCase();
    if (!codigo) {
      setErrorMsg('Insira o ID do talão emitido pela Tesouraria.');
      return;
    }

    try {
      setAValidarTalao(true);
      setErrorMsg('');
      setSuccessMsg('');
      setTalaoConfirmado(null);
      setAlunoSelecionado(null);
      setTermoPesquisaAluno('');
      setValoresAlocacao({});
      const response = await fetch(
        `${API_TESOURARIA}/pagamentos/talao/${encodeURIComponent(codigo)}`,
        { credentials: 'include', cache: 'no-store' }
      );
      const data = await lerRespostaApi(response);
      const talao = data.dados;
      if (talao.utilizado) throw new Error('Este talão já foi associado a uma conta de aluno.');
      setTalaoConfirmado({ codigo_talao: talao.codigo_talao, valor: talao.valor });
      setSuccessMsg(`ID ${talao.codigo_talao} válido e ainda não utilizado.`);
    } catch (error) {
      setTalaoConfirmado(null);
      setErrorMsg(error.message || 'Não foi possível confirmar o talão.');
    } finally {
      setAValidarTalao(false);
    }
  };

  const atualizarMontante = (itemId, valor) => {
    setValoresAlocacao((atuais) => ({ ...atuais, [itemId]: valor }));
  };

  const selecionarAluno = (aluno) => {
    setAlunoSelecionado(aluno);
    setTermoPesquisaAluno(aluno.nome);
    setResultadosAlunos({ termo: aluno.nome, alunos: [] });
  };

  const submeterRegistoSecretaria = async (event) => {
    event.preventDefault();
    if (!talaoConfirmado || !alunoSelecionado || alocacoes.length === 0) {
      setErrorMsg('Confirme o talão, selecione o aluno e distribua o valor pelos itens de pagamento.');
      return;
    }
    if (totalAlocadoCentimos !== valorTalaoCentimos) {
      setErrorMsg('A soma das parcelas tem de corresponder exatamente ao valor do talão.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');
      const response = await fetch(
        `${API_TESOURARIA}/pagamentos/talao/${encodeURIComponent(talaoConfirmado.codigo_talao)}/alocacoes`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matricula_id: alunoSelecionado.matricula_id,
            ano_letivo_id: anoLetivoId,
            classe: classeSelecionada,
            alocacoes
          })
        }
      );
      const data = await lerRespostaApi(response);
      setSuccessMsg(`${data.message} ${alunoSelecionado.nome}: ${formatarMoeda(totalAlocadoCentimos / 100)} registados na conta da matrícula.`);
      setIdTalaoInput('');
      setTalaoConfirmado(null);
      setAlunoSelecionado(null);
      setTermoPesquisaAluno('');
      setResultadosAlunos({ termo: '', alunos: [] });
      setValoresAlocacao({});
    } catch (error) {
      setErrorMsg(error.message || 'Não foi possível guardar o pagamento na conta do aluno.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AdminHeader
        titulo="Propinas e conta do aluno"
        descricao="Valide o ID do talão e distribua o montante pelas cobranças do aluno."
      />

      {errorMsg && <div className="sec-alert sec-alert-error" role="alert">{errorMsg}</div>}
      {successMsg && <div className="sec-alert sec-alert-success" role="status">{successMsg}</div>}

      <div className="sec-grid">
        <aside className="sec-card sec-precos-card">
          <h2 className="sec-card-title">
            <BsJournalText aria-hidden="true" /> Preços definidos pela escola
          </h2>
          <div className="sec-form-group">
            <label htmlFor="precos-ano">Ano letivo</label>
            <select
              id="precos-ano"
              value={anoLetivoId}
              className="sec-select"
              onChange={(event) => {
                setAnoLetivoId(event.target.value);
                setAlunoSelecionado(null);
                setTermoPesquisaAluno('');
                setResultadosAlunos({ termo: '', alunos: [] });
                setValoresAlocacao({});
              }}
            >
              {anosLetivos.map((ano) => {
                const id = String(ano.ano_letivo_id || ano.id);
                return <option key={id} value={id}>{ano.ano_nome}{ano.ativo ? ' (Ativo)' : ''}</option>;
              })}
            </select>
          </div>
          <div className="sec-form-group">
            <label htmlFor="precos-classe">Classe</label>
            <select
              id="precos-classe"
              value={classeSelecionada}
              onChange={(event) => {
                setClasseSelecionada(event.target.value);
                setAlunoSelecionado(null);
                setTermoPesquisaAluno('');
                setResultadosAlunos({ termo: '', alunos: [] });
                setValoresAlocacao({});
              }}
              className="sec-select"
            >
              <option value="">Selecione a classe</option>
              {classes.map((classe) => <option key={classe} value={classe}>{classe}</option>)}
            </select>
          </div>
          <div className="sec-precos-lista">
            {itensDisponiveisNaClasse.map((item) => {
              const preco = item.classe_precos.find((regra) =>
                String(regra.classe).toLowerCase() === classeSelecionada.toLowerCase() &&
                String(regra.ano_letivo_id) === anoLetivoId
              )?.valor;
              return (
                <div key={item.id} className="sec-preco-pill">
                  <div className="sec-preco-info">
                    <span className="sec-preco-nome">{item.nome}</span>
                    {item.descricao && <span className="sec-preco-desc">{item.descricao}</span>}
                  </div>
                  <span className="sec-preco-valor">{formatarMoeda(preco)}</span>
                </div>
              );
            })}
            {carregandoDados && <p className="sec-empty">A carregar preços...</p>}
            {!carregandoDados && itensDisponiveisNaClasse.length === 0 && (
              <p className="sec-empty">Não há preços configurados para o ano letivo e a classe selecionada.</p>
            )}
          </div>
        </aside>

        <section className="sec-card sec-pagamento-card">
          <h2 className="sec-card-title">Associar talão à conta do aluno</h2>

          <form onSubmit={confirmarTalaoTesouraria} className="sec-talao-form">
            <label htmlFor="id-talao">ID do talão emitido pela Tesouraria</label>
            <div className="sec-talao-controls">
              <input
                id="id-talao"
                type="text"
                placeholder="TAL-..., REC-MAO-... ou ENT-..."
                value={idTalaoInput}
                onChange={(event) => {
                  setIdTalaoInput(event.target.value);
                  setTalaoConfirmado(null);
                  setSuccessMsg('');
                }}
                className="sec-input"
                autoComplete="off"
                required
              />
              <button type="submit" disabled={aValidarTalao || carregandoDados} className="sec-btn-primary">
                <BsShieldCheck aria-hidden="true" />
                {aValidarTalao ? 'A confirmar...' : 'Confirmar talão'}
              </button>
            </div>
          </form>

          {talaoConfirmado && (
            <form onSubmit={submeterRegistoSecretaria} className="sec-associacao-form">
              <div className="sec-talao-confirmado">
                <BsCheckCircleFill aria-hidden="true" />
                <span>
                  ID {talaoConfirmado.codigo_talao} validado · {formatarMoeda(talaoConfirmado.valor)}
                </span>
              </div>

              <div className="sec-contexto-grid">
                <div className="sec-form-group">
                  <label htmlFor="ano-talao">1. Ano letivo</label>
                  <select
                    id="ano-talao"
                    value={anoLetivoId}
                    className="sec-select"
                    onChange={(event) => {
                      setAnoLetivoId(event.target.value);
                      setAlunoSelecionado(null);
                      setTermoPesquisaAluno('');
                      setValoresAlocacao({});
                    }}
                  >
                    {anosLetivos.map((ano) => {
                      const id = String(ano.ano_letivo_id || ano.id);
                      return <option key={id} value={id}>{ano.ano_nome}{ano.ativo ? ' (Ativo)' : ''}</option>;
                    })}
                  </select>
                </div>
                <div className="sec-form-group">
                  <label htmlFor="classe-talao">2. Classe do pagamento</label>
                  <select
                    id="classe-talao"
                    value={classeSelecionada}
                    className="sec-select"
                    onChange={(event) => {
                      setClasseSelecionada(event.target.value);
                      setAlunoSelecionado(null);
                      setTermoPesquisaAluno('');
                      setValoresAlocacao({});
                    }}
                  >
                    <option value="">Selecione a classe</option>
                    {classes.map((classe) => <option key={classe} value={classe}>{classe}</option>)}
                  </select>
                </div>
              </div>
              {(!anoSelecionado || !classeValida) && (
                <p className="sec-alert sec-alert-error">
                  Selecione um ano letivo e uma classe disponíveis nesta escola.
                </p>
              )}

              <div className="sec-form-group sec-aluno-pesquisa">
                <label htmlFor="pesquisa-aluno">3. Procurar aluno por nome, matrícula, ID ou contacto</label>
                <div className="sec-search-field">
                  <BsSearch aria-hidden="true" />
                  <input
                    id="pesquisa-aluno"
                    type="search"
                    placeholder="Escreva pelo menos 2 caracteres..."
                    value={termoPesquisaAluno}
                    onChange={(event) => {
                      setTermoPesquisaAluno(event.target.value);
                      setAlunoSelecionado(null);
                      setErrorMsg('');
                    }}
                    className="sec-input"
                    autoComplete="off"
                  />
                </div>
                {termoPesquisaAluno.trim().length >= 2 && !alunoSelecionado && (
                  <div className="sec-alunos-resultados">
                    {pesquisandoAlunos && <p className="sec-empty">A pesquisar alunos...</p>}
                    {!pesquisandoAlunos && alunosFiltrados.map((aluno) => (
                      <button
                        key={aluno.matricula_id}
                        type="button"
                        className="sec-aluno-opcao"
                        onClick={() => selecionarAluno(aluno)}
                      >
                        <strong>{aluno.nome}</strong>
                        <span>{aluno.numero_matricula} · {aluno.classe || 'Classe não indicada'}</span>
                      </button>
                    ))}
                    {!pesquisandoAlunos && resultadosAlunos.termo === termoPesquisaAluno.trim() && alunosFiltrados.length === 0 && (
                      <p className="sec-empty">Nenhum aluno ativo encontrado nesta classe e ano letivo.</p>
                    )}
                  </div>
                )}
                {alunoSelecionado && (
                  <div className="sec-aluno-selecionado">
                    <BsCheckCircleFill aria-hidden="true" />
                    {alunoSelecionado.nome} · Matrícula {alunoSelecionado.numero_matricula}
                  </div>
                )}
              </div>

              {alunoSelecionado && (
                <div className="sec-alocacoes">
                  <div className="sec-alocacoes-header">
                    <div>
                      <h3>4. Itens e montantes a registar</h3>
                      <p>Indique quanto deste talão será aplicado em cada item configurado.</p>
                    </div>
                    <strong>{formatarMoeda(totalAlocadoCentimos / 100)} / {formatarMoeda(talaoConfirmado.valor)}</strong>
                  </div>

                  {itensDoAluno.map((item) => {
                    const preco = item.classe_precos.find((regra) =>
                      String(regra.classe).toLowerCase() === classeSelecionada.toLowerCase() &&
                      String(regra.ano_letivo_id) === anoLetivoId
                    )?.valor;
                    return (
                      <div key={item.id} className="sec-alocacao-row">
                        <div>
                          <label htmlFor={`alocacao-${item.id}`}>{item.nome}</label>
                          <span>Preço definido: {formatarMoeda(preco)}</span>
                        </div>
                        <div className="sec-montante-field">
                          <input
                            id={`alocacao-${item.id}`}
                            type="number"
                            min="0"
                            max={talaoConfirmado.valor}
                            step="0.01"
                            inputMode="decimal"
                            placeholder="0,00"
                            value={valoresAlocacao[item.id] || ''}
                            onChange={(event) => atualizarMontante(item.id, event.target.value)}
                            className="sec-input"
                          />
                          <span>CFA</span>
                        </div>
                      </div>
                    );
                  })}
                  {!itensDoAluno.length && (
                    <p className="sec-empty">Não existem itens configurados para este aluno, ano letivo e ramo.</p>
                  )}
                  <div className={`sec-alocacao-total ${diferencaCentimos === 0 ? 'is-valid' : 'is-pending'}`}>
                    {diferencaCentimos === 0
                      ? 'O valor total do talão está distribuído.'
                      : diferencaCentimos > 0
                        ? `Falta distribuir ${formatarMoeda(diferencaCentimos / 100)}.`
                        : `O total excede o talão em ${formatarMoeda(Math.abs(diferencaCentimos) / 100)}.`}
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !anoSelecionado || !classeValida || diferencaCentimos !== 0 || !alocacoes.length}
                    className="sec-btn-primary sec-btn-success"
                  >
                    {loading ? 'A guardar na conta...' : 'Registar na conta do aluno'}
                  </button>
                </div>
              )}
            </form>
          )}

          {!talaoConfirmado && (
            <p className="sec-hint">
              Confirme primeiro o ID real do talão. Os campos do aluno e das parcelas só serão apresentados após a validação.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
