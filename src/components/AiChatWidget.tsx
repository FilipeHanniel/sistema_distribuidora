import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, X, BotMessageSquare } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import './AiChatWidget.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function AiChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { token } = useAuthStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const togglePanel = () => {
    if (isOpen) {
      setIsClosing(true);
      setTimeout(() => {
        setIsOpen(false);
        setIsClosing(false);
      }, 250);
    } else {
      setIsOpen(true);
    }
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: messageText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('http://localhost:3000/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: messageText })
      });

      if (res.ok) {
        const data = await res.json();
        const assistantMsg: ChatMessage = { role: 'assistant', content: data.response };
        setMessages(prev => [...prev, assistantMsg]);
      } else {
        const err = await res.json();
        const errorMsg: ChatMessage = { 
          role: 'assistant', 
          content: err.error || 'Desculpe, não consegui processar sua pergunta. Tente novamente.' 
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    } catch {
      const errorMsg: ChatMessage = { 
        role: 'assistant', 
        content: 'Erro de conexão com o servidor. Verifique se o backend está rodando.' 
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatMessage = (text: string) => {
    // Simple markdown-like formatting for bold and line breaks
    return text
      .split('\n')
      .map((line, i) => {
        const formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return `<p key="${i}">${formatted}</p>`;
      })
      .join('');
  };

  const suggestions = [
    'Qual o produto mais vendido este mês?',
    'Quais produtos estão com estoque baixo?',
    'Quanto faturamos na última semana?',
  ];

  return (
    <>
      {/* Floating Trigger Button */}
      <button 
        className={`ai-chat-trigger ${isOpen ? 'active' : ''}`}
        onClick={togglePanel}
        aria-label="Assistente IA"
      >
        {isOpen ? <X size={22} /> : <Sparkles size={22} />}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className={`ai-chat-panel ${isClosing ? 'closing' : ''}`}>
          {/* Header */}
          <div className="ai-chat-header">
            <div className="ai-chat-header-icon">
              <BotMessageSquare size={20} />
            </div>
            <div className="ai-chat-header-text">
              <h3>Assistente de Gestão</h3>
              <span>Pergunte sobre vendas, estoque e muito mais</span>
            </div>
          </div>

          {/* Messages */}
          <div className="ai-chat-messages">
            {messages.length === 0 && !isLoading && (
              <div className="ai-welcome">
                <div className="ai-welcome-icon">
                  <Sparkles size={24} />
                </div>
                <h4>Olá, Administrador!</h4>
                <p>Pergunte qualquer coisa sobre seu negócio. Eu tenho acesso a todos os dados atuais.</p>
                <div className="ai-welcome-suggestions">
                  {suggestions.map((s, i) => (
                    <button 
                      key={i} 
                      className="ai-suggestion-btn"
                      onClick={() => sendMessage(s)}
                    >
                      💡 {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div 
                key={i} 
                className={`ai-msg ${msg.role}`}
                dangerouslySetInnerHTML={
                  msg.role === 'assistant' 
                    ? { __html: formatMessage(msg.content) }
                    : undefined
                }
              >
                {msg.role === 'user' ? msg.content : undefined}
              </div>
            ))}

            {isLoading && (
              <div className="ai-typing">
                <div className="ai-typing-dot" />
                <div className="ai-typing-dot" />
                <div className="ai-typing-dot" />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="ai-chat-input-area">
            <input
              ref={inputRef}
              type="text"
              className="ai-chat-input"
              placeholder="Faça uma pergunta..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <button 
              className="ai-chat-send"
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              aria-label="Enviar"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
