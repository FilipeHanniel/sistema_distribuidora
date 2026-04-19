import { useState, useEffect } from 'react';
import { Lightbulb, X } from 'lucide-react';
import './CrossSellPopup.css';

interface CrossSellPopupProps {
  productName: string;
  suggestion: string;
  onClose: () => void;
}

export default function CrossSellPopup({ productName, suggestion, onClose }: CrossSellPopupProps) {
  const [isClosing, setIsClosing] = useState(false);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose();
    }, 8000);

    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300); // Match slideOutToLeft animation duration
  };

  return (
    <div className={`cross-sell-popup ${isClosing ? 'closing' : ''}`}>
      <div className="cross-sell-icon">
        <Lightbulb size={18} />
      </div>

      <div className="cross-sell-content">
        <div className="cross-sell-product">
          {productName}
          <span className="ai-tag">IA</span>
        </div>
        <div className="cross-sell-text">{suggestion}</div>
      </div>

      <button className="cross-sell-close" onClick={handleClose} aria-label="Fechar sugestão">
        <X size={14} />
      </button>

      <div className="cross-sell-timer">
        <div className="cross-sell-timer-fill" />
      </div>
    </div>
  );
}
