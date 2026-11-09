'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BsArrowDownCircleFill, BsArrowUpCircleFill, BsLockFill, BsUnlockFill, BsPrinterFill, BsReceipt } from 'react-icons/bs';
import '@/styles/t1.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_TESOURARIA = `${API_BASE}/api/v1/tesouraria`;
const API_ESCOLAS = `${API_BASE}/api/v1/escolas`;
const API_AUTH = `${API_BASE}/api/v1/auth`;

function dataLocalISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function gerarReferenciaInterna() {
  return `REC-MAO-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
}

async function lerRespostaApi(response) {
  const texto = await response.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`A resposta da API é inválida (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Erro no servidor (HTTP ${response.status}).`);
  }
  return data;
}

const formularioVazio = (tipo, data = '') => ({
  tipo,
  destinatario: '',
  descricao: '',
  metodo: tipo === 'entrada' ? 'Banco' : 'Mao',
  referencia: '',
  valor: '',
  data_movimento: data,
  observacoes: ''
});

function formatarData(valor) {
  if (!valor) return '—';
  const data = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleDateString('pt-PT');
}

function formatarHora(valor) {
  if (!valor) return '—';
  if (/^\d{2}:\d{2}$/.test(valor)) return valor;
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? '—'
    : data.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? '—'
    : data.toLocaleString('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
}

function formatarValor(valor) {
  return `${Number(valor || 0).toLocaleString('pt-PT')} CFA`;
}

export default function RegistarPagamentoTesouraria({ escolaIdProp }) {
  const [anosLetivos, setAnosLetivos] = useState([]);
  const [anoLetivoId, setAnoLetivoId] = useState('');
  const [polos, setPolos] = useState([]);
  const [poloId, setPoloId] = useState('');
  const [nomeEscola, setNomeEscola] = useState('');
  const [abaAtiva, setAbaAtiva] = useState('entrada');
  const [caixaEstado, setCaixaEstado] = useState({
    estado: 'fechado',
    aberto_em: null,
    fechado_em: null
  });
  const [carregandoCaixa, setCarregandoCaixa] = useState(true);
  const [alterandoCaixa, setAlterandoCaixa] = useState(false);
  const [movimentos, setMovimentos] = useState([]);
  const [resumo, setResumo] = useState({
    data_hoje: '',
    total_entradas: 0,
    total_saidas: 0,
    saldo_liquido: 0,
    quantidade: 0,
    quantidade_entradas: 0,
    quantidade_saidas: 0
  });
  const [formEntrada, setFormEntrada] = useState(() => formularioVazio('entrada'));
  const [formSaida, setFormSaida] = useState(() => formularioVazio('saida'));
  const [carregando, setCarregando] = useState(true);
  const [submetendo, setSubmetendo] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [reciboImprimir, setReciboImprimir] = useState(null);
  const caixaAberto = caixaEstado.estado === 'aberto';

  useEffect(() => {
    const controller = new AbortController();
    const carregarCatalogos = async () => {
      try {
        let idEscola = escolaIdProp || '';
        const sessao = await lerRespostaApi(await fetch(`${API_AUTH}/me`, {
          credentials: 'include',
          signal: controller.signal
        }));
        const contaAtiva = sessao.data?.conta_ativa;
        idEscola = idEscola || contaAtiva?.escola_id || '';
        setNomeEscola(contaAtiva?.escola_nome || '');
        if (!idEscola) throw new Error('Não foi possível identificar a escola ativa.');

        const [resAnos, resPolos] = await Promise.all([
          fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(idEscola)}/anos-letivos`, { credentials: 'include', signal: controller.signal }),
          fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(idEscola)}/polos`, { credentials: 'include', signal: controller.signal })
        ]);
        const [dataAnos, dataPolos] = await Promise.all([lerRespostaApi(resAnos), lerRespostaApi(resPolos)]);
        const anos = Array.isArray(dataAnos.dados) ? dataAnos.dados : [];
        const listaPolos = Array.isArray(dataPolos.data) ? dataPolos.data : [];
        setAnosLetivos(anos);
        setPolos(listaPolos);
        const anoAtivo = anos.find((ano) => ano.ativo) || anos[0];
        if (anoAtivo) setAnoLetivoId(String(anoAtivo.ano_letivo_id || anoAtivo.id));
        if (listaPolos.length) setPoloId(String(listaPolos[0].id));
      } catch (error) {
        if (error.name !== 'AbortError') setErrorMsg(error.message || 'Não foi possível carregar os dados da escola.');
      }
    };
    void carregarCatalogos();
    return () => controller.abort();
  }, [escolaIdProp]);

  const carregarMovimentos = useCallback(async (signal) => {
    const data = await lerRespostaApi(await fetch(`${API_TESOURARIA}/movimentos`, {
      credentials: 'include',
      cache: 'no-store',
      signal
    }));
    setMovimentos(Array.isArray(data.dados) ? data.dados : []);
    setResumo(data.resumo || {
      data_hoje: '',
      total_entradas: 0,
      total_saidas: 0,
      saldo_liquido: 0,
      quantidade: 0,
      quantidade_entradas: 0,
      quantidade_saidas: 0
    });
  }, []);

  const carregarEstadoCaixa = useCallback(async (signal) => {
    const data = await lerRespostaApi(await fetch(`${API_TESOURARIA}/caixa/estado`, {
      credentials: 'include',
      cache: 'no-store',
      signal
    }));
    setCaixaEstado(data.dados);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => carregarMovimentos(controller.signal))
      .catch((error) => {
        if (error.name !== 'AbortError') setErrorMsg(error.message || 'Não foi possível carregar os movimentos.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });
    return () => controller.abort();
  }, [carregarMovimentos]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => carregarEstadoCaixa(controller.signal))
      .catch((error) => {
        if (error.name !== 'AbortError') setErrorMsg(error.message || 'Não foi possível consultar o estado do caixa.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregandoCaixa(false);
      });
    return () => controller.abort();
  }, [carregarEstadoCaixa]);

  useEffect(() => {
      const controller = new AbortController();
      const sincronizarEstado = () => {
        void carregarEstadoCaixa(controller.signal).catch((error) => {
          if (error.name !== 'AbortError') setErrorMsg(error.message || 'Não foi possível atualizar o estado do caixa.');
        });
      };
      const intervalo = window.setInterval(sincronizarEstado, 30000);
      window.addEventListener('focus', sincronizarEstado);
      return () => {
        controller.abort();
        window.clearInterval(intervalo);
        window.removeEventListener('focus', sincronizarEstado);
      };
  }, [carregarEstadoCaixa]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const hoje = dataLocalISO();
      setFormEntrada((atual) => ({
        ...atual,
        data_movimento: hoje,
        referencia: atual.metodo === 'Mao' ? atual.referencia || gerarReferenciaInterna() : ''
      }));
      setFormSaida((atual) => ({
        ...atual,
        data_movimento: hoje,
        referencia: atual.metodo === 'Mao' ? atual.referencia || gerarReferenciaInterna() : ''
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!reciboImprimir) return undefined;
    const timer = window.setTimeout(() => window.print(), 80);
    const limparRecibo = () => setReciboImprimir(null);
    window.addEventListener('afterprint', limparRecibo, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', limparRecibo);
    };
  }, [reciboImprimir]);

  const movimentosVisiveis = movimentos.filter((item) => item.tipo === abaAtiva);
  const formulario = abaAtiva === 'entrada' ? formEntrada : formSaida;
  const atualizarFormulario = abaAtiva === 'entrada' ? setFormEntrada : setFormSaida;

  const prepararImpressao = (item) => {
    if (!nomeEscola) {
      setErrorMsg('Não foi possível identificar o nome da escola para imprimir o recibo.');
      return;
    }
    setReciboImprimir({ ...item, impresso_em: new Date().toISOString() });
  };

  const submeterMovimento = async (event) => {
    event.preventDefault();
    if (!caixaAberto) {
      setErrorMsg('O caixa está fechado. Reabra-o antes de registar um movimento.');
      return;
    }
    setSubmetendo(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const payload = {
        ...formulario,
        referencia: formulario.metodo === 'Mao'
          ? formulario.referencia || gerarReferenciaInterna()
          : formulario.referencia.trim(),
        data_movimento: resumo.data_hoje || formulario.data_movimento,
        ano_letivo_id: anoLetivoId || null,
        polo_id: poloId || null,
        valor: Number(formulario.valor)
      };
      const data = await lerRespostaApi(await fetch(`${API_TESOURARIA}/movimentos`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }));
      setSuccessMsg(`${abaAtiva === 'entrada' ? 'Entrada' : 'Saída'} registada. Recibo ${data.dados.referencia}.`);
      prepararImpressao(data.dados);
      const proximoFormulario = formularioVazio(abaAtiva, dataLocalISO());
      if (proximoFormulario.metodo === 'Mao') proximoFormulario.referencia = gerarReferenciaInterna();
      atualizarFormulario(proximoFormulario);
      await carregarMovimentos();
    } catch (error) {
      setErrorMsg(error.message || 'Não foi possível registar o movimento.');
    } finally {
      setSubmetendo(false);
    }
  };

  const atualizarCampo = (campo, valor) => atualizarFormulario((atual) => ({ ...atual, [campo]: valor }));
  const atualizarMetodo = (metodo) => atualizarFormulario((atual) => ({
    ...atual,
    metodo,
    referencia: metodo === 'Mao' ? gerarReferenciaInterna() : ''
  }));

  const alterarEstadoCaixa = async () => {
    const acao = caixaAberto ? 'fecho' : 'abertura';
    setAlterandoCaixa(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const data = await lerRespostaApi(await fetch(`${API_TESOURARIA}/caixa/estado`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao })
      }));
      setCaixaEstado((atual) => ({
        ...atual,
        ...data.dados,
        aberto_em: acao === 'abertura' ? data.dados.evento_em : atual.aberto_em,
        fechado_em: acao === 'fecho' ? data.dados.evento_em : atual.fechado_em,
        aberto_hora: acao === 'abertura' ? data.dados.hora_evento : atual.aberto_hora,
        fechado_hora: acao === 'fecho' ? data.dados.hora_evento : atual.fechado_hora
      }));
      setSuccessMsg(`${data.message}. A Direção foi notificada com os totais do caixa.`);
    } catch (error) {
      setErrorMsg(error.message || 'Não foi possível alterar o estado do caixa.');
    } finally {
      setAlterandoCaixa(false);
    }
  };

  return (
    <>
      <header className="t1-recibos-header t1-caixa-header">
        <div>
          <span className="t1-recibos-kicker">TESOURARIA / CAIXA</span>
          <h1>Movimentos diários</h1>
          <p>Registe e acompanhe entradas e saídas do caixa de hoje.</p>
        </div>
        <div className="t1-recibos-actions">
          <span className={`t1-caixa-status ${caixaAberto ? 'aberto' : 'fechado'}`}>
            {carregandoCaixa
              ? 'A consultar caixa…'
              : caixaAberto
                ? `Caixa aberto · ${formatarHora(caixaEstado.aberto_hora || caixaEstado.aberto_em)}`
                : `Caixa fechado${caixaEstado.fechado_hora || caixaEstado.fechado_em ? ` · ${formatarHora(caixaEstado.fechado_hora || caixaEstado.fechado_em)}` : ''}`}
          </span>
          <button type="button" className={caixaAberto ? 't1-caixa-close' : 't1-caixa-open'} onClick={alterarEstadoCaixa} disabled={carregandoCaixa || alterandoCaixa}>
            {caixaAberto
              ? <><BsLockFill aria-hidden="true" /> {alterandoCaixa ? 'A fechar…' : 'Fechar caixa'}</>
              : <><BsUnlockFill aria-hidden="true" /> {alterandoCaixa ? 'A abrir…' : 'Abrir caixa'}</>}
          </button>
        </div>
      </header>

      {errorMsg && <div className="msg-alerta msg-erro" role="alert">{errorMsg}</div>}
      {successMsg && (
        <div className="msg-alerta msg-sucesso" role="status">
          <span>{successMsg}</span>
          {reciboImprimir && (
            <button type="button" className="tesouraria-recibo-action" onClick={() => prepararImpressao(reciboImprimir)}>
              <BsPrinterFill aria-hidden="true" /> Imprimir recibo
            </button>
          )}
        </div>
      )}

      <section className="t1-recibos-panel t1-caixa-panel">
        <div className="t1-recibos-panel-heading t1-caixa-panel-heading">
          <div>
            <h2>Movimentos de caixa</h2>
            <p>{resumo.data_hoje ? `Hoje · ${formatarData(resumo.data_hoje)}` : 'Movimentos registados hoje'}</p>
          </div>
          <div className="t1-caixa-tabs" role="tablist" aria-label="Tipo de movimento">
            <button type="button" role="tab" aria-selected={abaAtiva === 'entrada'} className={abaAtiva === 'entrada' ? 'entrada active' : 'entrada'} onClick={() => setAbaAtiva('entrada')}>
              <BsArrowDownCircleFill aria-hidden="true" /> Entradas <span>{resumo.quantidade_entradas}</span>
            </button>
            <button type="button" role="tab" aria-selected={abaAtiva === 'saida'} className={abaAtiva === 'saida' ? 'saida active' : 'saida'} onClick={() => setAbaAtiva('saida')}>
              <BsArrowUpCircleFill aria-hidden="true" /> Saídas <span>{resumo.quantidade_saidas}</span>
            </button>
          </div>
        </div>

        <div className="t1-caixa-content">
          <section className="t1-caixa-form">
            <div className="t1-caixa-form-heading">
              <span className={`t1-caixa-form-icon ${abaAtiva}`}>
                {abaAtiva === 'entrada' ? <BsArrowDownCircleFill aria-hidden="true" /> : <BsArrowUpCircleFill aria-hidden="true" />}
              </span>
              <div>
                <h3>{abaAtiva === 'entrada' ? 'Registar entrada' : 'Registar saída'}</h3>
                <p>{abaAtiva === 'entrada' ? 'Nova receita ou crédito' : 'Nova despesa ou débito'}</p>
              </div>
            </div>
            <form onSubmit={submeterMovimento}>
              <div className="form-group">
                <label htmlFor="movimento-polo">Polo</label>
                <select id="movimento-polo" className="form-select" value={poloId} onChange={(event) => setPoloId(event.target.value)}>
                  <option value="">Todos os polos</option>
                  {polos.map((polo) => <option key={polo.id} value={polo.id}>{polo.nome}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="movimento-destinatario">{abaAtiva === 'entrada' ? 'Origem / pagador' : 'Destinatário / fornecedor'}</label>
                <input id="movimento-destinatario" className="form-input" value={formulario.destinatario} onChange={(event) => atualizarCampo('destinatario', event.target.value)} placeholder={abaAtiva === 'entrada' ? 'Nome do aluno ou entidade' : 'Nome do fornecedor'} />
              </div>
              <div className="form-group">
                <label htmlFor="movimento-descricao">{abaAtiva === 'entrada' ? 'Descrição da entrada' : 'Motivo da saída'} *</label>
                <input id="movimento-descricao" className="form-input" required maxLength={160} value={formulario.descricao} onChange={(event) => atualizarCampo('descricao', event.target.value)} placeholder={abaAtiva === 'entrada' ? 'Ex.: Propina, contribuição' : 'Ex.: Material, manutenção'} />
              </div>
              <div className="t1-caixa-field-row">
                <div className="form-group">
                  <label htmlFor="movimento-metodo">Método</label>
                  <select id="movimento-metodo" className="form-select" value={formulario.metodo} onChange={(event) => atualizarMetodo(event.target.value)}>
                    <option value="Banco">Banco (talão bancário)</option>
                    <option value="Mao">Mão (Tesouraria / Dinheiro)</option>
                    <option value="Orange Money">Orange Money</option>
                    <option value="MTN Mobile">MTN Mobile Money</option>
                    <option value="Outros">Outros</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="movimento-referencia">TAL ID / referência</label>
                  <input id="movimento-referencia" className="form-input tesouraria-id-input" maxLength={80} value={formulario.referencia} onChange={(event) => atualizarCampo('referencia', event.target.value)} placeholder={formulario.metodo === 'Mao' ? 'REC-MAO gerado automaticamente' : 'Referência, se existir'} />
                </div>
              </div>
              <div className="t1-caixa-field-row">
                <div className="form-group">
                  <label htmlFor="movimento-valor">Montante (CFA) *</label>
                  <input id="movimento-valor" type="number" min="0.01" step="0.01" className="form-input" required value={formulario.valor} onChange={(event) => atualizarCampo('valor', event.target.value)} placeholder="0" />
                </div>
                <div className="form-group">
                  <label htmlFor="movimento-data">Data</label>
                  <input id="movimento-data" type="date" className="form-input" required value={resumo.data_hoje || formulario.data_movimento} readOnly aria-readonly="true" />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="movimento-observacoes">Observações</label>
                <input id="movimento-observacoes" className="form-input" maxLength={500} value={formulario.observacoes} onChange={(event) => atualizarCampo('observacoes', event.target.value)} placeholder="Opcional" />
              </div>
              <button type="submit" className={`t1-caixa-submit ${abaAtiva}`} disabled={!caixaAberto || submetendo}>
                {submetendo ? 'A registar…' : `Registar ${abaAtiva === 'entrada' ? 'entrada' : 'saída'}`}
              </button>
              {!caixaAberto && <p className="t1-caixa-closed-note">Abra o caixa para registar movimentos.</p>}
            </form>
          </section>

          <section className="t1-caixa-table-section">
            <div className="t1-caixa-table-heading">
              <div>
                <h3>{abaAtiva === 'entrada' ? 'Entradas de hoje' : 'Saídas de hoje'}</h3>
                <p>Movimentos confirmados no caixa diário.</p>
              </div>
              <span>{movimentosVisiveis.length}</span>
            </div>
            <div className="t1-recibos-table-wrap">
              <table className="t1-recibos-table t1-caixa-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>{abaAtiva === 'entrada' ? 'Origem / pagador' : 'Destinatário'}</th>
                    <th>Descrição</th>
                    <th>Referência</th>
                    <th className="t1-recibos-number">Montante</th>
                    <th aria-label="Ação" />
                  </tr>
                </thead>
                <tbody>
                  {carregando ? (
                    <tr><td colSpan="6" className="t1-recibos-empty">A carregar movimentos…</td></tr>
                  ) : movimentosVisiveis.length ? movimentosVisiveis.map((item) => (
                    <tr key={item.id}>
                      <td>{formatarData(item.data_movimento)}</td>
                      <td><strong>{item.destinatario || 'Não especificado'}</strong></td>
                      <td>{item.descricao}</td>
                      <td><code>{item.referencia}</code></td>
                      <td className={`t1-recibos-number ${item.tipo}`}>
                        {item.tipo === 'entrada' ? '+' : '−'} {formatarValor(item.valor)}
                      </td>
                      <td>
                        <button type="button" className="t1-caixa-print-row" onClick={() => prepararImpressao(item)} aria-label={`Imprimir recibo ${item.referencia}`} title="Imprimir recibo">
                          <BsPrinterFill aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="6" className="t1-recibos-empty">Ainda não há movimentos deste tipo hoje.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      {reciboImprimir && (
        <section className="tesouraria-recibo-impressao" aria-label="Recibo para impressão">
          <p className="tesouraria-recibo-timestamp">{formatarDataHora(reciboImprimir.impresso_em)}</p>
          <div className="tesouraria-recibo-brand"><strong>{nomeEscola || 'Escola'}</strong><span>TESOURARIA</span></div>
          <div className="tesouraria-recibo-rule" />
          <h2>{reciboImprimir.tipo === 'entrada' ? 'RECIBO DE ENTRADA' : 'COMPROVATIVO DE SAÍDA'}</h2>
          <p className="tesouraria-recibo-referencia">{reciboImprimir.referencia}</p>
          <dl>
            <div><dt>Data</dt><dd>{formatarData(reciboImprimir.data_movimento)}</dd></div>
            <div><dt>{reciboImprimir.tipo === 'entrada' ? 'Recebido de' : 'Pago a'}</dt><dd>{reciboImprimir.destinatario || 'Não especificado'}</dd></div>
            <div><dt>Descrição</dt><dd>{reciboImprimir.descricao}</dd></div>
            <div><dt>Método</dt><dd>{reciboImprimir.metodo === 'Mao' ? 'Dinheiro' : reciboImprimir.metodo}</dd></div>
          </dl>
          <div className="tesouraria-recibo-total">
            <span>{reciboImprimir.tipo === 'entrada' ? 'Total recebido' : 'Total pago'}</span>
            <strong>{formatarValor(reciboImprimir.valor)}</strong>
          </div>
          <div className="tesouraria-recibo-rule" />
          <p className="tesouraria-recibo-footer">Documento emitido pelo {nomeEscola || 'Escola'} · Guarde este comprovativo.</p>
          <div className="tesouraria-recibo-signature">Assinatura / carimbo</div>
          <div className="tesouraria-recibo-screen-action"><BsReceipt aria-hidden="true" /> Recibo pronto para impressão</div>
        </section>
      )}
    </>
  );
}
