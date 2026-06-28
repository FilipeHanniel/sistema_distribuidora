import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, CreditCard, Loader2, Pause, Play, Printer, QrCode, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { FiscalDocument, SaleItem } from '../types';
import './SaleSuccessPopup.css';

interface SaleSuccessPopupProps {
  totalAmount: number;
  paymentMethod: 'money' | 'card' | 'pix';
  operatorName: string;
  saleId: string;
  items: SaleItem[];
  createdAt?: string;
  fiscalDocument?: FiscalDocument | null;
  autoClose?: boolean;
  autoCloseSeconds?: number;
  establishmentName?: string;
  receiptFooter?: string;
  showProcessing?: boolean;
  onClose: () => void;
}

type FlowStage =
  | 'payment_processing'
  | 'payment_done'
  | 'fiscal_sending'
  | 'fiscal_authorized'
  | 'printing'
  | 'done'
  | 'fiscal_rejected';

const METHOD_LABELS: Record<string, string> = {
  money: 'Dinheiro',
  card: 'Cartao',
  pix: 'PIX',
};

const METHOD_ICONS: Record<string, ReactNode> = {
  money: <Banknote size={20} />,
  card: <CreditCard size={20} />,
  pix: <QrCode size={20} />,
};

const FISCAL_LABELS: Record<string, string> = {
  pending_configuration: 'Fiscal pendente',
  pending_authorization: 'Aguardando autorizacao',
  authorized: 'Fiscal autorizada',
  rejected: 'Fiscal rejeitada',
  cancelled: 'Fiscal cancelada',
};

const STAGE_INFO: Record<FlowStage, { label: string; badge: string; kind: 'processing' | 'done' | 'warning' }> = {
  payment_processing: { label: 'Processando pagamento...', badge: 'Aguardando confirmacao', kind: 'processing' },
  payment_done: { label: 'Pagamento concluido!', badge: 'Pagamento aprovado', kind: 'done' },
  fiscal_sending: { label: 'Comunicando com a SEFAZ...', badge: 'Enviando NFC-e', kind: 'processing' },
  fiscal_authorized: { label: 'NFC-e autorizada', badge: 'Autorizada', kind: 'done' },
  printing: { label: 'Imprimindo NF...', badge: 'Preparando impressao', kind: 'processing' },
  done: { label: 'Venda concluida!', badge: 'Documento disponivel', kind: 'done' },
  fiscal_rejected: { label: 'NFC-e rejeitada', badge: 'Corrigir fiscal', kind: 'warning' },
};

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function playSuccessSound() {
  try {
    const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.2);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.25);
    });
  } catch {
    // Browser may block audio without interaction.
  }
}

const formatAccessKey = (key?: string) => {
  if (!key) return '';
  return key.replace(/(.{4})/g, '$1 ').trim();
};

export default function SaleSuccessPopup({
  totalAmount,
  paymentMethod,
  operatorName,
  saleId,
  items,
  createdAt,
  fiscalDocument,
  autoClose = true,
  autoCloseSeconds = 5,
  establishmentName = '',
  receiptFooter = '',
  showProcessing = true,
  onClose,
}: SaleSuccessPopupProps) {
  const isMachine = showProcessing && (paymentMethod === 'card' || paymentMethod === 'pix');
  const [stage, setStage] = useState<FlowStage>(!autoClose ? 'done' : isMachine ? 'payment_processing' : 'payment_done');
  const closeSeconds = Math.max(1, autoCloseSeconds);
  const [countdown, setCountdown] = useState(closeSeconds);
  const [paused, setPaused] = useState(false);
  const [currentFiscalDocument, setCurrentFiscalDocument] = useState<FiscalDocument | null>(fiscalDocument || null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const now = createdAt ? new Date(createdAt) : new Date();
  const dateLabel = now.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const fiscalAuthorized = currentFiscalDocument?.status === 'authorized';
  const showVirtualNote = Boolean(fiscalAuthorized && ['printing', 'done'].includes(stage));
  const isTerminalStage = stage === 'done' || stage === 'fiscal_rejected';
  const currentStage = {
    ...STAGE_INFO[stage],
    label: stage === 'done' && fiscalAuthorized ? 'Venda e NFC-e concluidas!' : STAGE_INFO[stage].label,
    badge: stage === 'done' && !currentFiscalDocument ? 'Comprovante interno' : STAGE_INFO[stage].badge,
  };

  useEffect(() => {
    setCurrentFiscalDocument(fiscalDocument || null);
  }, [fiscalDocument]);

  useEffect(() => {
    if (!isMachine) {
      playSuccessSound();
      return;
    }
    const timer = setTimeout(() => {
      setStage('payment_done');
      playSuccessSound();
    }, 2200);
    return () => clearTimeout(timer);
  }, [isMachine]);

  useEffect(() => {
    if (stage !== 'payment_done') return;
    const timer = setTimeout(async () => {
      if (!autoClose) {
        setStage('done');
        return;
      }

      if (currentFiscalDocument) {
        setStage('fiscal_sending');
        return;
      }

      try {
        const response = await apiRequest<{ document?: FiscalDocument | null }>(`/fiscal/sales/${saleId}`);
        if (response.document) {
          setCurrentFiscalDocument(response.document);
          setStage('fiscal_sending');
        } else {
          setStage('done');
        }
      } catch {
        setStage('done');
      }
    }, 850);
    return () => clearTimeout(timer);
  }, [stage, currentFiscalDocument, autoClose, saleId]);

  useEffect(() => {
    if (stage !== 'fiscal_sending') return;
    const timer = setTimeout(() => {
      setStage(currentFiscalDocument?.status === 'authorized' ? 'fiscal_authorized' : 'fiscal_rejected');
    }, 1300);
    return () => clearTimeout(timer);
  }, [stage, currentFiscalDocument]);

  useEffect(() => {
    if (stage !== 'fiscal_authorized') return;
    const timer = setTimeout(() => setStage('printing'), 900);
    return () => clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'printing') return;
    const timer = setTimeout(() => setStage('done'), 950);
    return () => clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (!isTerminalStage || paused || !autoClose) return;

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    timerRef.current = setTimeout(() => onClose(), closeSeconds * 1000);

    return () => {
      clearInterval(countdownRef.current!);
      clearTimeout(timerRef.current!);
    };
  }, [isTerminalStage, paused, autoClose, closeSeconds, onClose]);

  const handleClose = () => {
    clearTimeout(timerRef.current!);
    clearInterval(countdownRef.current!);
    onClose();
  };

  const togglePaused = () => {
    if (paused) {
      setCountdown(closeSeconds);
      setPaused(false);
      return;
    }
    clearTimeout(timerRef.current!);
    clearInterval(countdownRef.current!);
    setPaused(true);
  };

  const renderIcon = () => {
    if (stage === 'printing') return <Printer size={28} className="sale-popup__check" />;
    if (currentStage.kind === 'processing') return <Loader2 size={28} className="sale-popup__spinner" />;
    if (currentStage.kind === 'warning') return <AlertTriangle size={28} className="sale-popup__check" />;
    return <CheckCircle2 size={28} className="sale-popup__check" />;
  };

  return (
    <div className={`sale-popup ${currentStage.kind === 'warning' ? 'sale-popup--warning' : currentStage.kind === 'done' ? 'sale-popup--done' : 'sale-popup--processing'}`}>
      <div className="sale-popup__header">
        <div className="sale-popup__icon-wrap">{renderIcon()}</div>
        <div className="sale-popup__titles">
          <span className="sale-popup__status-label">{currentStage.label}</span>
          <span className="sale-popup__date">{dateLabel}</span>
        </div>
        <div className="sale-popup__header-actions">
          {isTerminalStage && autoClose && (
            <button className="sale-popup__close" onClick={togglePaused} title={paused ? 'Retomar fechamento automatico' : 'Pausar fechamento automatico'}>
              {paused ? <Play size={17} /> : <Pause size={17} />}
              <span className="sale-popup__countdown">{paused ? 'pause' : `${countdown}s`}</span>
            </button>
          )}
          <button className="sale-popup__close" onClick={handleClose} title="Fechar">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="sale-popup__body">
        <div className="sale-popup__amount">{formatCurrency(totalAmount)}</div>

        <div className="sale-popup__details">
          <div className="sale-popup__method">
            {METHOD_ICONS[paymentMethod]}
            <span>{METHOD_LABELS[paymentMethod]}</span>
          </div>
          <div className={`sale-popup__badge ${currentStage.kind}`}>{currentStage.badge}</div>
        </div>

        <div className="sale-popup__footer">
          <span className="sale-popup__op">Operador: <strong>{operatorName}</strong></span>
          <span className="sale-popup__id">#{saleId.slice(0, 8).toUpperCase()}</span>
        </div>

        {stage !== 'payment_processing' && (
          <div className="sale-popup__receipt">
            {establishmentName && <div className="sale-popup__business-name">{establishmentName}</div>}
            <div className="sale-popup__receipt-title">
              <strong>{showVirtualNote ? 'Nota virtual' : 'Recibo da venda'}</strong>
              <span>
                {showVirtualNote
                  ? 'DANFE NFC-e simulado disponivel na tela.'
                  : currentFiscalDocument ? 'Aguarde a comunicacao fiscal para liberar a NFC-e.' : 'Comprovante interno sem emissao fiscal.'}
              </span>
            </div>
            <div className="sale-popup__receipt-items">
              {items.length === 0 ? (
                <div className="sale-popup__receipt-empty">Itens indisponiveis nesta visualizacao.</div>
              ) : items.map(item => (
                <div className="sale-popup__receipt-item" key={item.productId}>
                  <span>{item.quantity}x {item.name}</span>
                  <strong>{formatCurrency(item.totalPrice)}</strong>
                  <small>{formatCurrency(item.unitPrice)} / un</small>
                </div>
              ))}
            </div>
            <div className="sale-popup__receipt-total">
              <span>Total</span>
              <strong>{formatCurrency(totalAmount)}</strong>
            </div>
            {receiptFooter && <div className="sale-popup__receipt-note">{receiptFooter}</div>}

            {currentFiscalDocument && stage === 'fiscal_rejected' && (
              <div className="sale-popup__fiscal">
                <span>{FISCAL_LABELS[currentFiscalDocument.status] || currentFiscalDocument.status}</span>
                {currentFiscalDocument.cStat && <strong>cStat: {currentFiscalDocument.cStat}</strong>}
                {currentFiscalDocument.error && <small>{currentFiscalDocument.error}</small>}
              </div>
            )}

            {showVirtualNote && currentFiscalDocument && (
              <div className="sale-popup__fiscal">
                <span>{FISCAL_LABELS[currentFiscalDocument.status] || currentFiscalDocument.status}</span>
                <div className="sale-popup__danfe">
                  <div className="sale-popup__danfe-head">
                    <strong>DANFE NFC-e simulado</strong>
                    <small>Documento sem valor fiscal</small>
                  </div>
                  <div className="sale-popup__danfe-grid">
                    <span>Modelo 65</span>
                    <span>Serie {currentFiscalDocument.serie || '-'}</span>
                    <span>Numero {currentFiscalDocument.number || '-'}</span>
                    <span>cStat {currentFiscalDocument.cStat || '100'}</span>
                  </div>
                  {currentFiscalDocument.accessKey && (
                    <div className="sale-popup__access-key">
                      <small>Chave de acesso</small>
                      <strong>{formatAccessKey(currentFiscalDocument.accessKey)}</strong>
                    </div>
                  )}
                  {currentFiscalDocument.qrCodeUrl && (
                    <div className="sale-popup__qr">
                      <QrCode size={42} />
                      <small>{currentFiscalDocument.qrCodeUrl}</small>
                    </div>
                  )}
                </div>
                {currentFiscalDocument.protocol && <strong>Protocolo: {currentFiscalDocument.protocol}</strong>}
                {currentFiscalDocument.error && <small>{currentFiscalDocument.error}</small>}
              </div>
            )}
          </div>
        )}
      </div>

      {isTerminalStage && autoClose && !paused && (
        <div className="sale-popup__progress">
          <div className="sale-popup__progress-bar" style={{ animationDuration: `${closeSeconds}s` }} />
        </div>
      )}
    </div>
  );
}
