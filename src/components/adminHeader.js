'use client';

import { BsArrowClockwise, BsPlus, BsPlusLg, BsPrinter } from 'react-icons/bs';
import { BiBookOpen } from 'react-icons/bi';

export default function AdminHeader({ titulo, descricao, anoVal, mudarAnoLetivo, dashboard, onRefresh, loading = false, modalBtn, modalBtnText = "Novo Registo", escolaIdLogada, onPrint, printText = "Imprimir Relatório", atualizadoEm, sumItemText, sumItem, children }) {
    const dataAtualizacao = atualizadoEm ? new Date(atualizadoEm) : null;

    return (
        <>
            <header className="top-bar header-bar admin-sticky-header">
                <div className="top-info">
                    <h1>{titulo || 'A carregar...'}</h1>
                    <p>{descricao || 'Consulte os dados institucionais'}</p>
                </div>

                <div className="dashboard-header-actions" >
                    {anoVal !== undefined && dashboard?.anos_letivos && (
                        <div className="top-ano">
                            <label htmlFor="anos">Ano Letivo</label>
                            <select id="anos" value={anoVal} onChange={mudarAnoLetivo} disabled={!dashboard || loading}>
                                {!dashboard?.anos_letivos.length && <option value="">Sem ano letivo</option>}
                                {dashboard?.anos_letivos.map((ano) => (
                                    <option key={ano.id} value={ano.id}>{ano.ano_nome}</option>
                                ))}
                            </select>
                            <BiBookOpen className="ano-icon" />
                        </div>
                    )}
                    {onPrint && (
                        <button type="button" onClick={onPrint} className="ce-btn-submit btn-header-print" disabled={loading}>
                            <BsPrinter size={16} /> {printText}
                        </button>
                    )}
                    {modalBtn && (
                        <button onClick={modalBtn} disabled={!escolaIdLogada} className="ce-btn-submit">
                            <BsPlusLg size={16}/> {modalBtnText}
                        </button>
                    )}
                    {children}
                    {onRefresh && (
                        <button type="button" className="ce-btn-submit direcao-refresh-button" onClick={onRefresh} disabled={loading} aria-label="Atualizar dados" title="Atualizar lista">
                            <BsArrowClockwise className={loading ? 'spin' : ''} />
                        </button>
                    )}
                    {sumItem && (
                        <div className="top-ano">
                          <label htmlFor='anos'>{sumItemText}</label>
                          <button type="button" onClick={sumItem} title="Nova Escola">
                            <BsPlus size={18} />
                          </button>
                        </div>
                    )}
                </div>
            </header>
            {dataAtualizacao && !Number.isNaN(dataAtualizacao.getTime()) && (
                <p className="dashboard-updated">Dados consultados em {dataAtualizacao.toLocaleString('pt-PT')}</p>
            )}
        </>
    );
}