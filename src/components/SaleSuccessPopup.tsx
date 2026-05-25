import { useEffect, useState, useRef, type ReactNode } from 'react';
import { CheckCircle2, Loader2, CreditCard, Banknote, QrCode, X } from 'lucide-react';
import type { SaleItem } from '../types';
import './SaleSuccessPopup.css';

interface SaleSuccessPopupProps {
  totalAmount: number;
  paymentMethod: 'money' | 'card' | 'pix';
  operatorName: string;
  saleId: string;
  items: SaleItem[];
  onClose: () => void;
}

const METHOD_LABELS: Record<string, string> = {
  money: 'Dinheiro',
  card: 'Cartão',
  pix: 'PIX',
};

const METHOD_ICONS: Record<string, ReactNode> = {
  money: <Banknote size={20} />,
  card: <CreditCard size={20} />,
  pix: <QrCode size={20} />,
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
    // Browser may block audio without interaction
  }
}

export default function SaleSuccessPopup({ totalAmount, paymentMethod, operatorName, saleId, items, onClose }: SaleSuccessPopupProps) {
  const isMachine = paymentMethod === 'card' || paymentMethod === 'pix';
  const [status, setStatus] = useState<'processing' | 'done'>(isMachine ? 'processing' : 'done');
  const [countdown, setCountdown] = useState(5);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const now = new Date();
  const dateLabel = now.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Simulate machine processing for card/pix
  useEffect(() => {
    if (isMachine) {
      const t = setTimeout(() => {
        setStatus('done');
        playSuccessSound();
      }, 2200);
      return () => clearTimeout(t);
    } else {
      playSuccessSound();
    }
  }, [isMachine]);

  // Auto-close countdown (starts only when done)
  useEffect(() => {
    if (status !== 'done') return;

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    timerRef.current = setTimeout(() => {
      onClose();
    }, 5000);

    return () => {
      clearInterval(countdownRef.current!);
      clearTimeout(timerRef.current!);
    };
  }, [status, onClose]);

  const handleClose = () => {
    clearTimeout(timerRef.current!);
    clearInterval(countdownRef.current!);
    onClose();
  };

  return (
    <div className={`sale-popup ${status === 'done' ? 'sale-popup--done' : 'sale-popup--processing'}`}>
      <div className="sale-popup__header">
        <div className="sale-popup__icon-wrap">
          {status === 'processing' ? (
            <Loader2 size={28} className="sale-popup__spinner" />
          ) : (
            <CheckCircle2 size={28} className="sale-popup__check" />
          )}
        </div>
        <div className="sale-popup__titles">
          <span className="sale-popup__status-label">
            {status === 'processing' ? 'Processando Pagamento...' : 'Venda Concluída!'}
          </span>
          <span className="sale-popup__date">{dateLabel}</span>
        </div>
        <button className="sale-popup__close" onClick={handleClose} title="Fechar">
          <X size={18} />
          {status === 'done' && <span className="sale-popup__countdown">{countdown}s</span>}
        </button>
      </div>

      <div className="sale-popup__body">
        <div className="sale-popup__amount">{formatCurrency(totalAmount)}</div>

        <div className="sale-popup__details">
          <div className="sale-popup__method">
            {METHOD_ICONS[paymentMethod]}
            <span>{METHOD_LABELS[paymentMethod]}</span>
          </div>
          <div className={`sale-popup__badge ${status}`}>
            {status === 'processing' ? 'Aguardando maquininha...' : 'Pagamento Aprovado'}
          </div>
        </div>

        <div className="sale-popup__footer">
          <span className="sale-popup__op">Operador: <strong>{operatorName}</strong></span>
          <span className="sale-popup__id">#{saleId.slice(0, 8).toUpperCase()}</span>
        </div>

        {status === 'done' && (
          <div className="sale-popup__receipt">
            <div className="sale-popup__receipt-title">
              <strong>Cupom digital</strong>
              <span>Recibo interno sem valor fiscal</span>
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
          </div>
        )}
      </div>

      {status === 'done' && (
        <div className="sale-popup__progress">
          <div className="sale-popup__progress-bar" style={{ animationDuration: '5s' }} />
        </div>
      )}
    </div>
  );
}
