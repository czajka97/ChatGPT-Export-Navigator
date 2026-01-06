
import React, { useState, useMemo, useRef, useEffect, useDeferredValue, useCallback, Component, ErrorInfo } from "react";
import { createRoot } from "react-dom/client";
// Added ArrowUpDown to the imports from lucide-react
import { Upload, MessageSquare, Search, Menu, X, ChevronLeft, Calendar, User, Bot, Filter, Download, Copy, Check, ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle, ChevronUp, ChevronDown, Shield, Edit2, CheckSquare, Square, FileText, Activity, Info, Zap, Terminal, Hash, ExternalLink, Cpu, Box, ListRestart, SortAsc, SortDesc, Clock, ListOrdered, Type } from "lucide-react";

// --- Error Boundary ---
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
          <AlertTriangle size={48} className="text-red-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-gray-400 mb-4">The application crashed. Here is the error message:</p>
          <pre className="bg-gray-900 p-4 rounded text-red-300 text-sm overflow-auto max-w-2xl text-left border border-gray-800">
            {this.state.error?.toString()}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            className="mt-6 px-4 py-2 bg-blue-600 rounded hover:bg-blue-500 transition-colors"
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Custom Virtual List ---
const VirtualList = ({ itemCount, itemSize, height, width, children, itemData }: any) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const totalHeight = itemCount * itemSize;
  const startIndex = Math.floor(scrollTop / itemSize);
  const endIndex = Math.min(
    itemCount - 1,
    floor((scrollTop + height) / itemSize) + 5
  );

  function floor(n: number) { return Math.floor(n); }
  
  const visibleItems = [];
  if (itemCount > 0) {
      for (let i = startIndex; i <= endIndex; i++) {
        if (i < 0) continue; 
        visibleItems.push(
          React.createElement(children, {
            key: i,
            index: i,
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${itemSize}px`,
              transform: `translateY(${i * itemSize}px)`,
            },
            data: itemData
          })
        );
      }
  }

  return (
    <div 
      ref={containerRef}
      style={{ height, width, overflowY: 'auto', position: 'relative', willChange: 'transform' }}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      className="custom-scrollbar"
    >
      <div style={{ height: totalHeight, width: '100%', position: 'relative' }}>
        {visibleItems}
      </div>
    </div>
  );
};


// --- Types ---

interface Author {
  role: "system" | "user" | "assistant" | "tool";
  name?: string;
  metadata?: any;
}

interface Content {
  content_type: string;
  parts?: string[];
}

interface Message {
  id: string;
  author: Author;
  create_time: number;
  content: Content;
  status: string;
  metadata?: any;
  recipient?: string;
}

interface MappingNode {
  id: string;
  message: Message | null;
  parent: string | null;
  children: string[];
}

interface Mapping {
  [key: string]: MappingNode;
}

interface Conversation {
  title: string;
  create_time: number;
  update_time: number;
  mapping: Mapping;
  current_node: string;
  conversation_id: string;
  _originalIndex?: number; // Internal helper for sorting
}

type SortOption = 'actual' | 'date-desc' | 'date-asc' | 'length' | 'title';

// --- Helper Functions ---

const formatDate = (timestamp: number) => {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatTime = (timestamp: number) => {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const countMatchesInString = (text: string, term: string) => {
  if (!term || !text) return 0;
  const re = new RegExp(escapeRegExp(term), 'gi');
  const matches = text.match(re);
  return matches ? matches.length : 0;
};

const getLinearMessages = (conversation: Conversation): Message[] => {
  const messages: Message[] = [];
  let currentNodeId: string | null = conversation.current_node;

  while (currentNodeId) {
    const node = conversation.mapping[currentNodeId];
    if (!node) break;

    if (node.message && node.message.content) {
        const hasParts = !!(node.message.content.parts && node.message.content.parts.length > 0);
        if (node.message.author.role !== 'system' || (node.message.content.content_type === 'text' && hasParts)) {
           messages.push(node.message);
        }
    }
    currentNodeId = node.parent;
  }

  return messages.reverse();
};

const conversationHasContent = (conversation: Conversation, term: string): boolean => {
  const termLower = term.toLowerCase();
  if (conversation.title.toLowerCase().includes(termLower)) return true;
  for (const nodeId in conversation.mapping) {
    const node = conversation.mapping[nodeId];
    if (node.message && node.message.content && node.message.content.parts) {
      const text = node.message.content.parts.join(' ');
      if (text.toLowerCase().includes(termLower)) return true;
    }
  }
  return false;
};

const getSearchSnippet = (conversation: Conversation, term: string): string | null => {
  if (!term) return null;
  const termLower = term.toLowerCase();
  for (const nodeId in conversation.mapping) {
    const node = conversation.mapping[nodeId];
    if (node.message && node.message.content && node.message.content.parts) {
      const text = node.message.content.parts.join(' ');
      const index = text.toLowerCase().indexOf(termLower);
      if (index !== -1) {
        const start = Math.max(0, index - 25);
        const end = Math.min(text.length, index + term.length + 45);
        return (start > 0 ? "..." : "") + text.substring(start, end) + (end < text.length ? "..." : "");
      }
    }
  }
  return null;
};

// --- Research Mode Components ---

interface Insight {
  id: string;
  label: string;
  value: string;
  type: 'thought' | 'summary' | 'system' | 'tool_call' | 'tool_response' | 'diagnostic';
  timestamp: number;
}

const ResearchPanel: React.FC<{ conversation: Conversation; messages: Message[] }> = ({ conversation, messages }) => {
  const modelSlug = useMemo(() => {
    for (const msg of messages) {
      if (msg.metadata?.model_slug) return msg.metadata.model_slug;
    }
    return "Standard Engine";
  }, [messages]);

  const insights = useMemo(() => {
    const results: Insight[] = [];
    
    Object.values(conversation.mapping).forEach(node => {
      const msg = node.message;
      if (!msg) return;

      if (msg.metadata?.thought) {
        results.push({ 
          id: msg.id, 
          label: 'Model Reasoning', 
          value: msg.metadata.thought, 
          type: 'thought', 
          timestamp: msg.create_time 
        });
      }

      if (msg.metadata?.turn_summary) {
        results.push({ 
          id: msg.id, 
          label: 'Turn Summary', 
          value: msg.metadata.turn_summary, 
          type: 'summary', 
          timestamp: msg.create_time 
        });
      }

      if (msg.recipient && msg.recipient !== 'all') {
        results.push({ 
          id: msg.id, 
          label: `Call: ${msg.recipient}`, 
          value: msg.content?.parts?.join('\n') || "Empty Call Payload", 
          type: 'tool_call', 
          timestamp: msg.create_time 
        });
      }

      if (msg.author.role === 'tool') {
        results.push({ 
          id: msg.id, 
          label: `Result: ${msg.author.name || 'External'}`, 
          value: msg.content?.parts?.join('\n') || "Empty Response Payload", 
          type: 'tool_response', 
          timestamp: msg.create_time 
        });
      }

      if (msg.author.role === 'system' && msg.content?.content_type === 'text') {
        const text = msg.content.parts?.join('\n');
        if (text && text.length > 0) {
           results.push({ 
             id: msg.id, 
             label: 'System Context', 
             value: text, 
             type: 'system', 
             timestamp: msg.create_time 
           });
        }
      }

      if (msg.metadata?.finish_details) {
         results.push({
             id: msg.id,
             label: 'Exit State',
             value: JSON.stringify(msg.metadata.finish_details, null, 2),
             type: 'diagnostic',
             timestamp: msg.create_time
         });
      }
    });

    const seen = new Set();
    return results
      .filter(item => {
        const key = `${item.id}-${item.type}-${item.value.substring(0, 30)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [conversation]);

  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-4', 'ring-emerald-500/50', 'ring-offset-4', 'ring-offset-gray-950', 'bg-emerald-500/10');
      setTimeout(() => el.classList.remove('ring-4', 'ring-emerald-500/50', 'ring-offset-4', 'ring-offset-gray-950', 'bg-emerald-500/10'), 2500);
    }
  };

  return (
    <div className="w-80 lg:w-[450px] bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden h-full animate-in slide-in-from-right duration-300 shadow-2xl">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-950">
        <div className="flex items-center gap-2">
          <Cpu size={18} className="text-emerald-400" />
          <h3 className="font-bold text-xs tracking-widest text-emerald-400 uppercase">Engine Trace</h3>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-gray-900/50 space-y-8 pb-20">
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-blue-400" />
            <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Model Identifier</h4>
          </div>
          <div className="bg-gray-950 rounded-lg p-3 border border-gray-800/60 shadow-inner group transition-colors hover:border-blue-500/30">
             <div className="text-[10px] text-gray-500 mb-1 font-mono uppercase">Architecture</div>
             <div className="font-mono text-sm text-blue-300 break-all">{modelSlug}</div>
             <div className="mt-3 text-[10px] text-gray-500 mb-1 font-mono uppercase">Session Trace</div>
             <div className="font-mono text-[9px] text-gray-500 break-all opacity-60 leading-tight">{conversation.conversation_id}</div>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <Terminal size={14} className="text-emerald-400" />
            <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Diagnostic Timeline</h4>
          </div>
          
          <div className="space-y-6 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-gray-800/50">
            {insights.length === 0 ? (
              <div className="text-[11px] text-gray-600 italic px-4 bg-gray-800/20 py-4 rounded">No diagnostic metadata extracted from this capture.</div>
            ) : insights.map((insight, idx) => (
              <div key={`${insight.id}-${idx}`} className="relative pl-7 group">
                <div className={`absolute left-0 top-1 w-6 h-6 rounded-full border-4 border-gray-900 flex items-center justify-center z-10 transition-transform group-hover:scale-110 shadow-lg ${
                  insight.type === 'thought' ? 'bg-purple-500' : 
                  insight.type === 'tool_call' ? 'bg-blue-500' : 
                  insight.type === 'tool_response' ? 'bg-indigo-600' : 
                  insight.type === 'summary' ? 'bg-emerald-500 shadow-emerald-500/20' : 
                  insight.type === 'diagnostic' ? 'bg-red-500' : 'bg-gray-600'
                }`}>
                   <Hash size={10} className="text-white" />
                </div>
                
                <div className="bg-gray-950 rounded-xl p-4 border border-gray-800/80 group-hover:border-gray-700 transition-all shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-tighter ${
                      insight.type === 'thought' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 
                      insight.type === 'tool_call' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 
                      insight.type === 'tool_response' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 
                      insight.type === 'summary' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 
                      insight.type === 'diagnostic' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 
                      'bg-gray-700 text-gray-300'
                    }`}>
                      {insight.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                        <button 
                            onClick={() => navigator.clipboard.writeText(insight.value)}
                            className="text-gray-600 hover:text-gray-300 transition-colors p-1"
                            title="Copy details"
                        >
                            <Copy size={12} />
                        </button>
                        <button 
                            onClick={() => jumpToMessage(insight.id)}
                            className="text-gray-600 hover:text-white transition-colors p-1"
                            title="Jump to trigger"
                        >
                            <ExternalLink size={12} />
                        </button>
                    </div>
                  </div>
                  <div className={`text-[11px] text-gray-300 font-mono leading-relaxed max-h-[400px] overflow-y-auto custom-scrollbar-thin whitespace-pre-wrap ${insight.type === 'summary' ? 'italic text-emerald-50/90 border-l-2 border-emerald-500/50 pl-3 py-1' : ''}`}>
                    {insight.value}
                  </div>
                  <div className="mt-3 flex justify-between items-center text-[9px] text-gray-600 font-mono">
                      <span>SEQUENCE +{idx}</span>
                      <span>{formatTime(insight.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

const HighlightedText: React.FC<{ text: string; term: string; startIndex: number; activeIndex: number }> = ({ text, term, startIndex, activeIndex }) => {
  if (!term || !text) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, 'gi'));
  let matchCounter = 0;
  return (
    <>
      {parts.map((part, i) => {
        if (part.toLowerCase() === term.toLowerCase()) {
          const currentId = startIndex + matchCounter;
          const isActive = currentId === activeIndex;
          matchCounter++;
          return (
            <span 
              key={i} 
              id={`match-${currentId}`}
              className={`${isActive ? "bg-yellow-400 text-black ring-2 ring-yellow-500 font-bold z-10 rounded-sm" : "bg-yellow-600/60 text-white rounded-sm"}`}
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
};

const MessageBubble: React.FC<{ 
  message: Message, 
  highlightTerm: string, 
  matchStartIndex: number, 
  activeMatchIndex: number 
}> = ({ message, highlightTerm, matchStartIndex, activeMatchIndex }) => {
  const isUser = message.author.role === "user";
  const text = message.content?.parts?.join("\n") || "";
  const parts = text.split(/```/);
  let localMatchCount = 0;

  return (
    <div id={`msg-${message.id}`} className={`flex w-full mb-6 transition-all duration-700 rounded-2xl p-2 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[85%] md:max-w-[75%] gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${isUser ? "bg-blue-600" : "bg-emerald-600"}`}>
          {isUser ? <User size={16} className="text-white" /> : <Bot size={16} className="text-white" />}
        </div>
        <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
           <div className={`px-4 py-3 rounded-2xl text-sm md:text-base shadow-sm overflow-hidden transition-colors ${isUser ? "bg-blue-600 text-white rounded-tr-sm" : "bg-gray-800 text-gray-100 border border-gray-700 rounded-tl-sm"}`}>
             <div className="prose prose-invert max-w-none break-words leading-relaxed whitespace-pre-wrap">
               {parts.map((part, i) => {
                 const matchesInPart = countMatchesInString(part, highlightTerm);
                 const currentStartIndex = matchStartIndex + localMatchCount;
                 localMatchCount += matchesInPart;
                 if (i % 2 === 1) {
                   return (
                     <pre key={i} className="my-2 bg-black/30 p-3 rounded text-xs font-mono overflow-x-auto border border-white/10">
                       <code>
                         <HighlightedText text={part.trim()} term={highlightTerm} startIndex={currentStartIndex} activeIndex={activeMatchIndex} />
                       </code>
                     </pre>
                   );
                 } else {
                   return <span key={i}><HighlightedText text={part} term={highlightTerm} startIndex={currentStartIndex} activeIndex={activeMatchIndex} /></span>;
                 }
               })}
             </div>
           </div>
           <span className="text-xs text-gray-500 mt-1 px-1 font-mono">{formatTime(message.create_time)}</span>
        </div>
      </div>
    </div>
  );
};

const FileUploader = ({ onDataLoaded }: { onDataLoaded: (data: Conversation[]) => void }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = (file: File) => {
    setLoading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      setTimeout(() => {
        try {
          const json = JSON.parse(e.target?.result as string);
          if (!Array.isArray(json)) throw new Error("Invalid format");
          const conversationsWithIdx = json.map((c: any, i: number) => ({ ...c, _originalIndex: i }));
          onDataLoaded(conversationsWithIdx);
        } catch (err) {
          setError("Failed to parse JSON. Might be too large.");
          setLoading(false);
        }
      }, 50);
    };
    reader.onerror = () => { setError("Error reading file."); setLoading(false); }
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950">
      <div className={`w-full max-w-xl p-10 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center transition-all duration-300 ${isDragging ? "border-blue-500 bg-blue-500/10" : "border-gray-700 hover:border-gray-500 bg-gray-900"}`} onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(e) => { e.preventDefault(); setIsDragging(false); if(e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }}>
        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-6 shadow-xl"><Upload size={32} className="text-blue-400" /></div>
        <h1 className="text-2xl font-bold text-white mb-2">Import ChatGPT History</h1>
        <p className="text-gray-400 mb-8">Drag and drop conversations.json</p>
        {loading && <div className="flex flex-col items-center gap-2"><div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div><p className="text-blue-400 animate-pulse">Scanning Archive Logic...</p></div>}
        {error && <p className="text-red-400 mt-4 max-w-sm">{error}</p>}
        {!loading && (
            <>
                <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors mt-4 shadow-lg shadow-blue-500/20">Select File<input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} /></label>
                <div className="flex items-center gap-2 mt-8 text-gray-500 text-xs opacity-70">
                    <Shield size={12} />
                    <span>Your data is processed locally in your browser. Nothing is ever uploaded.</span>
                </div>
            </>
        )}
      </div>
    </div>
  );
};

// Row component for VirtualList
const ConversationRow = React.memo(({ index, style, data }: any) => {
  const { items, selectedId, onSelect, searchTerm, searchContent, isEditMode, selectedForAction, toggleActionSelection } = data;
  const c = items[index];
  
  if (!c) return null;

  let snippet = (searchContent && searchTerm) ? getSearchSnippet(c, searchTerm) : null;
  const isChecked = isEditMode ? selectedForAction.has(c.conversation_id) : false;

  const handleClick = () => {
      if (isEditMode) {
          toggleActionSelection(c.conversation_id);
      } else {
          onSelect(c.conversation_id, (searchContent && searchTerm) ? searchTerm : undefined);
      }
  };

  return (
    <div style={style} className="px-2">
      <button 
        onClick={handleClick} 
        className={`w-full text-left p-3 rounded-lg transition-colors group flex items-start gap-3 ${selectedId === c.conversation_id && !isEditMode ? "bg-blue-600/20 border border-blue-600/50" : "hover:bg-gray-800 border border-transparent"}`} style={{ height: '100%' }}>
        
        {isEditMode && (
             <div className={`mt-0.5 w-4 h-4 rounded border flex shrink-0 items-center justify-center transition-all ${isChecked ? 'bg-blue-500 border-blue-500' : 'border-gray-500 bg-transparent'}`}>
                {isChecked && <Check size={12} className="text-white" />}
             </div>
        )}

        <div className="flex-1 min-w-0">
            <div className={`font-medium text-sm truncate mb-1 ${selectedId === c.conversation_id && !isEditMode ? "text-blue-100" : "text-gray-300 group-hover:text-white"}`}>{c.title || "Untitled Chat"}</div>
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5"><Calendar size={12} />{formatDate(c.create_time)}</div>
            {snippet && <div className="text-xs text-gray-400 italic truncate w-full opacity-80 mt-1">"{snippet}"</div>}
        </div>
      </button>
    </div>
  );
}, (prev, next) => {
    return prev.index === next.index && 
           prev.data.items[prev.index] === next.data.items[next.index] && 
           prev.data.selectedId === next.data.selectedId &&
           prev.style.top === next.style.top &&
           prev.data.isEditMode === next.data.isEditMode &&
           (prev.data.isEditMode ? prev.data.selectedForAction.has(prev.data.items[prev.index].conversation_id) === next.data.selectedForAction.has(next.data.items[next.index].conversation_id) : true);
});


const App = () => {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchContent, setSearchContent] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [inMessageSearchTerm, setInMessageSearchTerm] = useState("");
  const [isInMessageSearchOpen, setIsInMessageSearchOpen] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [isResearchMode, setIsResearchMode] = useState(false);
  const [sortType, setSortType] = useState<SortOption>('date-desc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  
  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedForAction, setSelectedForAction] = useState<Set<string>>(new Set());

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [sidebarHeight, setSidebarHeight] = useState(0);

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const deferredSearchContent = useDeferredValue(searchContent);
  const deferredInMessageSearchTerm = useDeferredValue(inMessageSearchTerm);

  useEffect(() => {
    if (!sidebarRef.current) return;
    const observer = new ResizeObserver((entries) => {
        if(entries[0]) setSidebarHeight(entries[0].contentRect.height);
    });
    observer.observe(sidebarRef.current);
    return () => observer.disconnect();
  }, [mobileMenuOpen, conversations, isEditMode]);

  // Handle click outside for sort menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    
    let result = [...conversations];

    // Filter
    if (deferredSearchTerm.trim()) {
      if (!deferredSearchContent) {
        result = result.filter(c => c.title.toLowerCase().includes(deferredSearchTerm.toLowerCase()));
      } else {
        result = result.filter(c => conversationHasContent(c, deferredSearchTerm));
      }
    }

    // Sort
    result.sort((a, b) => {
      switch (sortType) {
        case 'actual':
          return (a._originalIndex ?? 0) - (b._originalIndex ?? 0);
        case 'date-desc':
          return b.create_time - a.create_time;
        case 'date-asc':
          return a.create_time - b.create_time;
        case 'length':
          const lenA = Object.keys(a.mapping).length;
          const lenB = Object.keys(b.mapping).length;
          return lenB - lenA;
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

    return result;
  }, [conversations, deferredSearchTerm, deferredSearchContent, sortType]);

  const selectedConversation = useMemo(() => conversations?.find(c => c.conversation_id === selectedId), [conversations, selectedId]);
  const messages = useMemo(() => selectedConversation ? getLinearMessages(selectedConversation) : [], [selectedConversation]);

  const messageMatchData = useMemo(() => {
    if (!deferredInMessageSearchTerm) return { totalMatches: 0, matchOffsets: [] };
    let totalMatches = 0;
    const matchOffsets: number[] = [];
    messages.forEach(msg => {
      matchOffsets.push(totalMatches);
      const text = msg.content?.parts?.join("\n") || "";
      const parts = text.split(/```/);
      parts.forEach(part => totalMatches += countMatchesInString(part, deferredInMessageSearchTerm));
    });
    return { totalMatches, matchOffsets };
  }, [messages, deferredInMessageSearchTerm]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [selectedId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (selectedId && !isEditMode) {
          e.preventDefault();
          setIsInMessageSearchOpen(true);
          setTimeout(() => searchInputRef.current?.focus(), 10);
        }
      }
      if (e.key === 'Escape' && isInMessageSearchOpen) {
        setIsInMessageSearchOpen(false);
        setInMessageSearchTerm("");
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, isInMessageSearchOpen, isEditMode]);

  useEffect(() => {
    if (messageMatchData.totalMatches > 0) {
      const matchEl = document.getElementById(`match-${currentMatchIndex}`);
      if (matchEl) matchEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentMatchIndex, messageMatchData.totalMatches]);

  const handleSelect = useCallback((id: string, highlightText?: string) => {
    setSelectedId(id);
    setMobileMenuOpen(false);
    if (highlightText) {
      setInMessageSearchTerm(highlightText);
      setIsInMessageSearchOpen(true);
      setCurrentMatchIndex(0);
    } else {
      setInMessageSearchTerm("");
      setIsInMessageSearchOpen(false);
      setCurrentMatchIndex(0);
    }
  }, []);

  const handleCopyText = useCallback(() => {
    if (!selectedConversation || !messages.length) return;
    let text = `Title: ${selectedConversation.title}\nDate: ${formatDate(selectedConversation.create_time)} ${formatTime(selectedConversation.create_time)}\n\n`;
    messages.forEach(msg => {
       const content = msg.content?.parts?.join("\n") || "";
       text += `${msg.author.role === "user" ? "User" : "ChatGPT"} - ${formatTime(msg.create_time)}:\n${content}\n\n`;
    });
    navigator.clipboard.writeText(text).then(() => { setCopyFeedback(true); setTimeout(() => setCopyFeedback(false), 2000); });
  }, [selectedConversation, messages]);

  const handleDownloadTxt = useCallback(() => {
    if (!selectedConversation || !messages.length) return;
    let text = `==================================================\n`;
    text += `TITLE: ${selectedConversation.title}\n`;
    text += `DATE: ${formatDate(selectedConversation.create_time)} ${formatTime(selectedConversation.create_time)}\n`;
    text += `==================================================\n\n`;
    
    messages.forEach(msg => {
       const role = msg.author.role === "user" ? "User" : "ChatGPT";
       const content = msg.content?.parts?.join("\n") || "";
       text += `[${role}] (${formatTime(msg.create_time)}):\n`;
       text += `${content}\n\n`;
       text += `--------------------------------------------------\n\n`;
    });

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedConversation.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [selectedConversation, messages]);

  const handleDownloadJson = useCallback(() => {
    if (!selectedConversation) return;
    const blob = new Blob([JSON.stringify(selectedConversation, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedConversation.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [selectedConversation]);

  const toggleEditMode = useCallback(() => {
      setIsEditMode(prev => !prev);
      setSelectedForAction(new Set());
  }, []);

  const toggleActionSelection = useCallback((id: string) => {
      setSelectedForAction(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  }, []);

  const allFilteredSelected = useMemo(() => {
      if (filteredConversations.length === 0) return false;
      return filteredConversations.every(c => selectedForAction.has(c.conversation_id));
  }, [filteredConversations, selectedForAction]);

  const handleToggleSelectAll = useCallback(() => {
      setSelectedForAction(prev => {
          const next = new Set(prev);
          if (allFilteredSelected) {
              filteredConversations.forEach(c => next.delete(c.conversation_id));
          } else {
              filteredConversations.forEach(c => next.add(c.conversation_id));
          }
          return next;
      });
  }, [allFilteredSelected, filteredConversations]);


  const handleBulkExport = useCallback(() => {
      if (selectedForAction.size === 0) return;
      const subset = conversations?.filter(c => selectedForAction.has(c.conversation_id)) || [];
      const blob = new Blob([JSON.stringify(subset, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chatgpt_export_subset_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => { URL.revokeObjectURL(url); }, 300);
  }, [selectedForAction, conversations]);


  const itemData = useMemo(() => ({ 
      items: filteredConversations, 
      selectedId, 
      onSelect: handleSelect, 
      searchTerm: deferredSearchTerm, 
      searchContent: deferredSearchContent,
      isEditMode,
      selectedForAction,
      toggleActionSelection
  }), [filteredConversations, selectedId, handleSelect, deferredSearchTerm, deferredSearchContent, isEditMode, selectedForAction, toggleActionSelection]);
  
  const itemSize = (deferredSearchContent && deferredSearchTerm) ? 96 : 76;

  if (!conversations) return <ErrorBoundary><FileUploader onDataLoaded={setConversations} /></ErrorBoundary>;

  return (
    <ErrorBoundary>
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      <aside className={`absolute z-20 md:relative w-full md:w-80 lg:w-96 flex flex-col bg-gray-900 border-r border-gray-800 h-full transition-transform duration-300 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="p-4 border-b border-gray-800 flex items-center justify-between shrink-0 h-16">
            {!isEditMode ? (
                <>
                    <h2 className="font-bold text-lg flex items-center gap-2"><MessageSquare className="text-blue-500" size={20}/>History</h2>
                    <div className="flex items-center gap-2">
                         <button onClick={toggleEditMode} className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white" title="Edit list"><Edit2 size={18} /></button>
                         <button onClick={() => setMobileMenuOpen(false)} className="md:hidden p-2 hover:bg-gray-800 rounded-lg"><X size={20} /></button>
                    </div>
                </>
            ) : (
                <div className="flex items-center justify-between w-full">
                    <span className="font-semibold text-white">{selectedForAction.size} selected</span>
                    <button onClick={toggleEditMode} className="text-sm text-blue-400 hover:text-blue-300 font-medium px-3 py-1.5 hover:bg-blue-400/10 rounded">Done</button>
                </div>
            )}
        </div>
        
        <div className="p-4 shrink-0 flex flex-col gap-2 relative">
            {isEditMode ? (
                 <div className="h-[74px] flex flex-col justify-center gap-2">
                    <button 
                        onClick={handleToggleSelectAll} 
                        disabled={filteredConversations.length === 0}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gray-800 border border-gray-700 hover:bg-gray-750 text-sm font-medium text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {allFilteredSelected ? <CheckSquare size={16} className="text-blue-400" /> : <Square size={16} />}
                        {allFilteredSelected ? "Deselect All" : "Select All"}
                    </button>
                    {searchTerm && <div className="text-xs text-center text-gray-500">Matches: {filteredConversations.length}</div>}
                 </div>
            ) : (
                <>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
                            <input type="text" placeholder="Search conversations..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-gray-800 border border-gray-700 text-sm rounded-lg pl-9 pr-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-200 placeholder-gray-500" />
                        </div>
                        <div className="relative" ref={sortMenuRef}>
                            <button 
                                onClick={() => setShowSortMenu(!showSortMenu)}
                                className={`p-2 rounded-lg border transition-all ${showSortMenu ? 'bg-blue-600/20 border-blue-500/50 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}
                                title="Sort list"
                            >
                                <ArrowUpDown size={18} />
                            </button>
                            {showSortMenu && (
                                <div className="absolute right-0 mt-2 w-48 bg-gray-850 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in duration-150">
                                    <div className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-800 bg-gray-950/50">Sort By</div>
                                    <button onClick={() => { setSortType('date-desc'); setShowSortMenu(false); }} className={`w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-gray-800 transition-colors ${sortType === 'date-desc' ? 'text-blue-400 bg-blue-500/5' : 'text-gray-300'}`}>
                                        <Clock size={14} /> Date (Newest)
                                    </button>
                                    <button onClick={() => { setSortType('date-asc'); setShowSortMenu(false); }} className={`w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-gray-800 transition-colors ${sortType === 'date-asc' ? 'text-blue-400 bg-blue-500/5' : 'text-gray-300'}`}>
                                        <Clock size={14} className="rotate-180" /> Date (Oldest)
                                    </button>
                                    <button onClick={() => { setSortType('length'); setShowSortMenu(false); }} className={`w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-gray-800 transition-colors ${sortType === 'length' ? 'text-blue-400 bg-blue-500/5' : 'text-gray-300'}`}>
                                        <ListRestart size={14} /> Length (Longest)
                                    </button>
                                    <button onClick={() => { setSortType('title'); setShowSortMenu(false); }} className={`w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-gray-800 transition-colors ${sortType === 'title' ? 'text-blue-400 bg-blue-500/5' : 'text-gray-300'}`}>
                                        <Type size={14} /> Title (A-Z)
                                    </button>
                                    <button onClick={() => { setSortType('actual'); setShowSortMenu(false); }} className={`w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-gray-800 transition-colors ${sortType === 'actual' ? 'text-blue-400 bg-blue-500/5' : 'text-gray-300'}`}>
                                        <ListOrdered size={14} /> Original Order
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none"><input type="checkbox" checked={searchContent} onChange={(e) => setSearchContent(e.target.checked)} className="rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500/20" />Search content (slower)</label>
                </>
            )}
        </div>
        
        <div className="flex-1 overflow-hidden" ref={sidebarRef}>
          {filteredConversations.length === 0 ? <div className="text-center text-gray-500 mt-10 text-sm">No conversations found.</div> : 
            <VirtualList key={`${filteredConversations.length}-${sortType}`} height={sidebarHeight} itemCount={filteredConversations.length} itemSize={itemSize} width="100%" itemData={itemData}>{ConversationRow}</VirtualList>
          }
        </div>
        
        {isEditMode ? (
             <div className="p-3 border-t border-gray-800 shrink-0 bg-gray-900 z-10">
                 <button 
                    onClick={handleBulkExport} 
                    disabled={selectedForAction.size === 0}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-sm"
                 >
                    <Download size={16} /> Export Selection
                 </button>
             </div>
        ) : (
             <div className="p-3 border-t border-gray-800 text-xs text-center text-gray-600 shrink-0">{conversations.length} total • {filteredConversations.length} shown</div>
        )}
      </aside>

      <main className="flex-1 flex flex-col h-full relative w-full overflow-hidden">
        <div className="md:hidden flex items-center p-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur shrink-0 justify-between">
          <div className="flex items-center overflow-hidden"><button onClick={() => setMobileMenuOpen(true)} className="mr-3 p-2 hover:bg-gray-800 rounded-lg text-gray-400"><Menu size={20} /></button><span className="font-semibold text-gray-200 truncate">{selectedConversation?.title || "Select a conversation"}</span></div>
        </div>
        {selectedId ? (
          <div className="flex flex-1 overflow-hidden h-full">
            <div className="flex-1 flex flex-col min-w-0">
                <div className="hidden md:flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur z-10 shrink-0 relative">
                   {isInMessageSearchOpen ? (
                     <div className="absolute inset-0 z-20 bg-gray-900 flex items-center px-4 animate-in fade-in duration-200">
                        <Search className="text-gray-500 mr-3" size={18} />
                        <input ref={searchInputRef} type="text" placeholder="Find in conversation..." className="bg-transparent border-none outline-none text-white text-sm flex-1 mr-4 placeholder-gray-500" value={inMessageSearchTerm} onChange={(e) => { setInMessageSearchTerm(e.target.value); setCurrentMatchIndex(0); }} onKeyDown={(e) => { if(e.key === 'Enter') { e.preventDefault(); e.shiftKey ? setCurrentMatchIndex(p => p > 0 ? p - 1 : messageMatchData.totalMatches - 1) : setCurrentMatchIndex(p => p < messageMatchData.totalMatches - 1 ? p + 1 : 0); }}} />
                        <div className="flex items-center gap-2 mr-4 text-xs text-gray-400 whitespace-nowrap">
                            {messageMatchData.totalMatches > 0 ? (
                                <>
                                    <span className="mr-2">{currentMatchIndex + 1} of {messageMatchData.totalMatches}</span>
                                    <button onClick={() => setCurrentMatchIndex(p => p > 0 ? p - 1 : messageMatchData.totalMatches - 1)} className="p-1 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white"><ChevronUp size={16} /></button>
                                    <button onClick={() => setCurrentMatchIndex(p => p < messageMatchData.totalMatches - 1 ? p + 1 : 0)} className="p-1 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white"><ChevronDown size={16} /></button>
                                </>
                            ) : (inMessageSearchTerm && <span>No results</span>)}
                        </div>
                        <button onClick={() => { setIsInMessageSearchOpen(false); setInMessageSearchTerm(""); }} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white ml-2"><X size={18} /></button>
                     </div>
                   ) : (
                     <>
                       <div className="overflow-hidden mr-4"><h1 className="text-lg font-bold text-white truncate">{selectedConversation?.title || "Untitled Chat"}</h1><p className="text-xs text-gray-500 mt-1">{formatDate(selectedConversation?.create_time || 0)} · {formatTime(selectedConversation?.create_time || 0)}</p></div>
                       <div className="flex items-center gap-2 shrink-0">
                          <button 
                             onClick={() => setIsResearchMode(!isResearchMode)} 
                             className={`px-3 py-1.5 border rounded-md text-sm transition-all flex items-center gap-2 ${isResearchMode ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-lg shadow-emerald-500/10' : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300'}`}
                             title="Research Mode"
                          >
                            <Cpu size={16} />
                            <span className="hidden xl:inline">Process Trace</span>
                          </button>
                          <div className="w-px h-6 bg-gray-700 mx-1"></div>
                          <button onClick={() => { setIsInMessageSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 50); }} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-sm text-gray-300"><Search size={16} /></button>
                          <button onClick={handleCopyText} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-sm text-gray-300">{copyFeedback ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}<span className="hidden lg:inline">{copyFeedback ? "Copied" : "Copy"}</span></button>
                          <button onClick={handleDownloadTxt} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-sm text-gray-300"><FileText size={16} /><span className="hidden lg:inline">TXT</span></button>
                          <button onClick={handleDownloadJson} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-sm text-gray-300"><Download size={16} /><span className="hidden lg:inline">JSON</span></button>
                       </div>
                     </>
                   )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth custom-scrollbar" ref={scrollRef}>
                  <div className="max-w-3xl mx-auto">
                     {messages.length === 0 ? <div className="text-center text-gray-500 mt-20">No messages.</div> : messages.map((msg, idx) => (<MessageBubble key={msg.id} message={msg} highlightTerm={deferredInMessageSearchTerm} matchStartIndex={messageMatchData.matchOffsets[idx]} activeMatchIndex={currentMatchIndex} />))}
                     <div className="h-10"></div>
                  </div>
                </div>
            </div>
            {isResearchMode && selectedConversation && (
                <ResearchPanel conversation={selectedConversation} messages={messages} />
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-8">
            <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-6 shadow-2xl shadow-blue-500/5"><MessageSquare size={40} className="text-gray-600" /></div>
            <h2 className="text-2xl font-bold text-gray-300 mb-2">Welcome to your Archive</h2>
            <p className="max-w-md text-center">Select a conversation from the sidebar to inspect its engine-level procedural data.</p>
          </div>
        )}
      </main>
    </div>
    </ErrorBoundary>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
