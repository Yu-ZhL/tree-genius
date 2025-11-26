import React, { useState, useEffect, useRef } from 'react';
import {
    Folder, FileText, Copy, Trash2, Plus,
    Download, RefreshCw, Layers, Code,
    Loader2, HardDrive, Menu, X, Maximize2, Minimize2,
    Ban
} from 'lucide-react';

// --- 常量定义 ---

const DEFAULT_IGNORES = [
    'node_modules', '.git', '.idea', '.vscode', 'dist',
    'build', 'coverage', '__pycache__', '.DS_Store'
];

// 样式定义
const TREE_STYLES = {
    classic: {
        branch: '├── ',
        lastBranch: '└── ',
        vertical: '│   ',
        space: '    '
    },
    ascii: {
        branch: '|-- ',
        lastBranch: '`-- ',
        vertical: '|   ',
        space: '    '
    },
    minimal: {
        branch: '+ ',
        lastBranch: '+ ',
        vertical: '  ',
        space: '  '
    },
    // Indent 模式特殊处理，这里定义为空，我们在逻辑中单独处理空格
    indent: {
        branch: '',
        lastBranch: '',
        vertical: '',
        space: ''
    },
    emoji: {
        branch: '├── ',
        lastBranch: '└── ',
        vertical: '│   ',
        space: '    ',
        folderIcon: '📁 ',
        fileIcon: '📄 '
    }
};

const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function App() {
    // --- UI State ---
    const [isSidebarOpen, setIsSidebarOpen] = useState(true); // 移动端控制侧边栏
    const [isFullScreen, setIsFullScreen] = useState(false);  // 全屏预览

    // --- Data State ---
    const [fileList, setFileList] = useState([]);
    const [rootName, setRootName] = useState('project-root');

    // --- Generation State ---
    const [generatedTree, setGeneratedTree] = useState('');
    const [stats, setStats] = useState({ dirs: 0, files: 0, totalSize: 0 });
    const [isGenerating, setIsGenerating] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const abortControllerRef = useRef(null);

    // --- Config State (Persistent) ---
    const [config, setConfig] = useState(() => {
        const saved = localStorage.getItem('tree-genius-config-v3');
        return saved ? JSON.parse(saved) : {
            maxDepth: 10,
            style: 'classic',
            ignores: [...DEFAULT_IGNORES],
            showFiles: true,
            showSizes: false,
            trailingSlash: false,
            showStats: true
        };
    });
    const [ignoreInput, setIgnoreInput] = useState('');

    // --- Effects ---

    // 1. 持久化保存
    useEffect(() => {
        localStorage.setItem('tree-genius-config-v3', JSON.stringify(config));
    }, [config]);

    // 2. 移动端自适应：屏幕宽度小于 768px 时默认收起侧边栏
    useEffect(() => {
        if (window.innerWidth < 768) {
            setIsSidebarOpen(false);
        }
    }, []);

    // 3. 全屏 ESC 退出
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') setIsFullScreen(false);
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    // 4. 核心生成触发器
    useEffect(() => {
        if (fileList.length === 0) return;
        generateTreeProcess();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileList, config, rootName]);

    // --- 逻辑函数 ---

    const generateTreeProcess = async () => {
        if (abortControllerRef.current) abortControllerRef.current.abort();

        const controller = new AbortController();
        abortControllerRef.current = controller;
        const signal = controller.signal;

        setIsGenerating(true);
        setGeneratedTree(''); // 清空旧内容，显示加载感

        try {
            await new Promise(resolve => setTimeout(resolve, 50)); // UI 缓冲
            if (signal.aborted) return;

            const { treeString, statistics } = await buildTreeAsync(fileList, config, rootName, signal);

            if (!signal.aborted) {
                setGeneratedTree(treeString);
                setStats(statistics);
            }
        } catch (err) {
            if (err.message !== 'Aborted') {
                console.error("Error:", err);
                setGeneratedTree(`Error: ${err.message}`);
            }
        } finally {
            if (!signal.aborted) {
                setIsGenerating(false);
                abortControllerRef.current = null;
            }
        }
    };

    const buildTreeAsync = async (files, cfg, root, signal) => {
        const tree = {};
        const stats = { dirs: 0, files: 0, totalSize: 0 };
        const CHUNK_SIZE = 1500; // 批处理大小

        // 1. 构建树结构 (耗时操作)
        for (let i = 0; i < files.length; i++) {
            if (i % CHUNK_SIZE === 0) {
                await new Promise(r => setTimeout(r, 0));
                if (signal.aborted) throw new Error('Aborted');
            }

            const file = files[i];
            const path = file.webkitRelativePath || file.name;
            const parts = path.split('/');
            const relevantParts = parts.slice(1);

            if (relevantParts.some(part => cfg.ignores.includes(part))) continue;

            let currentLevel = tree;
            relevantParts.forEach((part, index) => {
                const isFile = index === relevantParts.length - 1;
                if (!currentLevel[part]) {
                    if (isFile) {
                        currentLevel[part] = { _type: 'file', size: file.size };
                        stats.files++;
                        stats.totalSize += file.size;
                    } else {
                        currentLevel[part] = { _type: 'dir', _children: {} };
                        stats.dirs++;
                    }
                }
                if (!isFile) currentLevel = currentLevel[part]._children;
            });
        }

        // 2. 渲染字符串
        let resultString = '';
        if (cfg.style === 'json') {
            resultString = JSON.stringify(tree, null, 2);
        } else {
            const rootLabel = cfg.trailingSlash ? `${root}/` : root;
            const rootSize = cfg.showSizes ? ` (${formatSize(stats.totalSize)})` : '';
            resultString = `${rootLabel}${rootSize}\n`;
            resultString += await renderNodes(tree, '', 0, cfg, signal);
        }

        return { treeString: resultString, statistics: stats };
    };

    const renderNodes = async (nodes, prefix, depth, cfg, signal) => {
        if (depth >= cfg.maxDepth) return '';
        if (signal.aborted) throw new Error('Aborted');

        let output = '';
        const entries = Object.entries(nodes).sort((a, b) => {
            const aIsDir = a[1]._type === 'dir';
            const bIsDir = b[1]._type === 'dir';
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a[0].localeCompare(b[0]);
        });

        const style = TREE_STYLES[cfg.style] || TREE_STYLES.classic;
        const isIndentMode = cfg.style === 'indent';

        for (let i = 0; i < entries.length; i++) {
            if (i % 500 === 0) await new Promise(r => setTimeout(r, 0));

            const [name, data] = entries[i];
            const isLast = i === entries.length - 1;
            const isDir = data._type === 'dir';

            if (!cfg.showFiles && !isDir) continue;

            let linePrefix = '';

            // --- Indent 模式逻辑 ---
            if (isIndentMode) {
                // 强制使用空格作为缩进，每一级深度增加 2 个空格 (或者 4 个)
                linePrefix = '  '.repeat(depth + 1);
            } else {
                // 其他模式使用树线逻辑
                linePrefix = prefix + (isLast ? style.lastBranch : style.branch);
            }

            let icon = '';
            if (cfg.style === 'emoji') icon = isDir ? style.folderIcon : style.fileIcon;

            let lineContent = name;
            if (isDir && cfg.trailingSlash) lineContent += '/';
            if (cfg.showSizes && !isDir) lineContent += ` (${formatSize(data.size)})`;

            output += `${linePrefix}${icon}${lineContent}\n`;

            if (isDir) {
                let nextPrefix = prefix;
                if (!isIndentMode) {
                    nextPrefix += (isLast ? style.space : style.vertical);
                }
                output += await renderNodes(data._children, nextPrefix, depth + 1, cfg, signal);
            }
        }
        return output;
    };

    // --- 交互处理 ---

    const handleFolderSelect = (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setFileList(Array.from(files));
        const firstPath = files[0].webkitRelativePath;
        if (firstPath) setRootName(firstPath.split('/')[0]);

        // 移动端选择后自动收起侧边栏，提升体验
        if (window.innerWidth < 768) setIsSidebarOpen(false);
    };

    const stopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setGeneratedTree(prev => prev + '\n\n>>> ⚠️ 用户已终止生成 <<<');
            setIsGenerating(false);
        }
    };

    const copyToClipboard = () => {
        if (!generatedTree) return;
        navigator.clipboard.writeText(generatedTree).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        }).catch(err => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = generatedTree;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    };

    const downloadFile = () => {
        const blob = new Blob([generatedTree], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${rootName}_tree.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const resetConfig = () => {
        if (confirm('恢复默认设置？')) {
            localStorage.removeItem('tree-genius-config-v3');
            window.location.reload();
        }
    };

    const Toggle = ({ label, checked, onChange }) => (
        <div className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-slate-50 px-1 rounded" onClick={() => onChange(!checked)}>
            <span className="text-sm text-slate-600 select-none">{label}</span>
            <div className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}>
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
            </div>
        </div>
    );

    return (
        <div className="h-screen bg-slate-100 text-slate-800 font-sans flex overflow-hidden">

            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-20 md:hidden backdrop-blur-sm"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            <div className={`
        fixed md:relative inset-y-0 left-0 z-30
        w-72 bg-white border-r border-slate-200 shadow-xl md:shadow-none
        transform transition-transform duration-300 ease-in-out flex flex-col
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
                <div className="h-14 px-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                    <div className="flex items-center gap-2 font-bold text-lg text-slate-800">
                        <Layers className="text-blue-600" size={20} />
                        TreeGenius
                    </div>
                    <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-slate-400 p-1">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">

                    {/* 1. 上传 */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-bold text-slate-400 uppercase">Input Source</label>
                            {fileList.length > 0 && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded">Loaded</span>}
                        </div>
                        <div className="relative group">
                            <input
                                type="file"
                                webkitdirectory=""
                                directory=""
                                multiple
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                onChange={handleFolderSelect}
                            />
                            <div className="border border-dashed border-blue-300 bg-blue-50 rounded-lg p-4 text-center hover:bg-blue-100 transition-colors">
                                <Folder className="mx-auto text-blue-500 mb-2" size={24} />
                                <p className="text-sm font-medium text-blue-700">选择文件夹</p>
                                <p className="text-xs text-blue-400 mt-1 scale-90">支持拖拽 / 点击</p>
                            </div>
                        </div>
                    </div>

                    {/* 2. 样式 */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase">Style & Depth</label>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { id: 'classic', label: '标准树' },
                                { id: 'indent', label: '仅缩进' },
                                { id: 'ascii', label: 'ASCII' },
                                { id: 'minimal', label: '极简' },
                                { id: 'emoji', label: 'Emoji' },
                                { id: 'json', label: 'JSON' }
                            ].map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => setConfig({ ...config, style: opt.id })}
                                    className={`text-xs py-2 px-1 rounded border transition-all truncate ${
                                        config.style === opt.id
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        <div className="pt-2 px-1">
                            <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                                <span>Depth: {config.maxDepth}</span>
                            </div>
                            <input
                                type="range" min="1" max="15" step="1"
                                value={config.maxDepth}
                                onChange={(e) => setConfig({...config, maxDepth: parseInt(e.target.value)})}
                                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                        </div>
                    </div>

                    {/* 3. 选项 */}
                    <div className="space-y-1 py-2 border-t border-b border-slate-100">
                        <Toggle label="显示文件" checked={config.showFiles} onChange={v => setConfig({...config, showFiles: v})} />
                        <Toggle label="显示大小" checked={config.showSizes} onChange={v => setConfig({...config, showSizes: v})} />
                        <Toggle label="尾部斜杠 (/)" checked={config.trailingSlash} onChange={v => setConfig({...config, trailingSlash: v})} />
                        <Toggle label="顶部统计信息" checked={config.showStats} onChange={v => setConfig({...config, showStats: v})} />
                    </div>

                    {/* 4. 排除 */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-bold text-slate-400 uppercase">Ignore List</label>
                            <button onClick={resetConfig} title="重置全部" className="text-slate-400 hover:text-red-500"><RefreshCw size={12}/></button>
                        </div>
                        <div className="flex gap-1">
                            <input
                                type="text"
                                value={ignoreInput}
                                onChange={e => setIgnoreInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && setConfig(c => ({...c, ignores: [...c.ignores, ignoreInput] }) || setIgnoreInput(''))}
                                placeholder="添加目录 (如 test)..."
                                className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded focus:border-blue-500 outline-none"
                            />
                            <button
                                onClick={() => { if(ignoreInput) { setConfig(c => ({...c, ignores: [...c.ignores, ignoreInput] })); setIgnoreInput(''); }}}
                                className="bg-slate-100 px-2 rounded text-slate-600 hover:bg-slate-200"
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {config.ignores.map(item => (
                                <span key={item} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 border border-slate-200 text-slate-600 text-[10px] rounded group cursor-default">
                  {item}
                                    <button onClick={() => setConfig(c => ({...c, ignores: c.ignores.filter(i => i !== item)}))} className="text-slate-400 hover:text-red-500">
                    <Trash2 size={10} />
                  </button>
                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* 主内容区 */}
            <div className="flex-1 flex flex-col min-w-0 bg-slate-50 relative">

                <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-3 md:px-6 shadow-sm shrink-0 z-10">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="md:hidden p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                            <Menu size={20} />
                        </button>

                        {/* 状态显示区 */}
                        {isGenerating ? (
                            <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium border border-blue-100 animate-in fade-in zoom-in duration-300">
                                <Loader2 className="animate-spin" size={14} />
                                <span className="hidden sm:inline">Generating Tree...</span>
                                <button onClick={stopGeneration} className="ml-2 pl-2 border-l border-blue-200 hover:text-red-500 flex items-center gap-1">
                                    <Ban size={12} /> <span className="hidden sm:inline">Stop</span>
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 text-slate-500 text-xs sm:text-sm truncate">
                                {config.showStats && fileList.length > 0 ? (
                                    <>
                                        <span className="flex items-center gap-1 font-medium text-slate-700"><Folder size={14} className="text-blue-500"/> {stats.dirs}</span>
                                        <span className="flex items-center gap-1 font-medium text-slate-700"><FileText size={14} className="text-blue-500"/> {stats.files}</span>
                                        <span className="hidden sm:flex items-center gap-1 text-slate-400"><HardDrive size={14}/> {formatSize(stats.totalSize)}</span>
                                    </>
                                ) : (
                                    <span className="text-slate-400 italic">Ready to generate</span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={downloadFile}
                            disabled={!generatedTree}
                            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-slate-600 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded-md text-xs font-medium transition-all"
                            title="下载文件"
                        >
                            <Download size={14} />
                            <span>下载</span>
                        </button>

                        <button
                            onClick={downloadFile}
                            disabled={!generatedTree}
                            className="sm:hidden p-2 text-slate-600 hover:text-blue-600"
                        >
                            <Download size={18} />
                        </button>

                        <button
                            onClick={copyToClipboard}
                            disabled={!generatedTree}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all shadow-sm ${
                                isCopied
                                    ? 'bg-green-600 text-white border border-green-600'
                                    : generatedTree
                                        ? 'bg-slate-900 text-white hover:bg-black border border-slate-900'
                                        : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                            }`}
                        >
                            {isCopied ? <span className="font-bold">Copied!</span> : <><Copy size={14}/> <span>复制</span></>}
                        </button>
                    </div>
                </div>

                <div className={`
          flex-1 p-2 md:p-6 flex flex-col transition-all duration-300
          ${isFullScreen ? 'fixed inset-0 z-50 bg-slate-900 p-0' : 'overflow-hidden relative'}
        `}>
                    <div className={`
            flex-1 bg-[#1e1e1e] shadow-2xl overflow-hidden flex flex-col border border-slate-700/50
            ${isFullScreen ? 'rounded-none border-none' : 'rounded-xl'}
          `}>
                        <div className="h-9 bg-[#252526] flex items-center px-4 justify-between shrink-0 select-none">
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1.5 group">
                                    <div className="w-3 h-3 rounded-full bg-[#ff5f56] group-hover:brightness-90" />
                                    <div className="w-3 h-3 rounded-full bg-[#ffbd2e] group-hover:brightness-90" />
                                    <div className="w-3 h-3 rounded-full bg-[#27c93f] group-hover:brightness-90" />
                                </div>
                                <span className="ml-3 text-xs text-zinc-500 font-mono hidden sm:inline">
                   {rootName}.{config.style === 'json' ? 'json' : 'txt'}
                 </span>
                            </div>

                            <div className="flex items-center gap-2">
                                {isGenerating && <Loader2 size={14} className="animate-spin text-blue-500" />}
                                <button
                                    onClick={() => setIsFullScreen(!isFullScreen)}
                                    className="text-zinc-500 hover:text-white transition-colors p-1"
                                    title={isFullScreen ? "退出全屏 (Esc)" : "全屏模式"}
                                >
                                    {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Code Content */}
                        <div className="flex-1 overflow-auto p-4 custom-scrollbar relative bg-[#1e1e1e]">
                            {!fileList.length && !isGenerating ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-700 select-none">
                                    <Code size={64} strokeWidth={1} />
                                    <p className="mt-4 text-sm">Waiting for input...</p>
                                </div>
                            ) : (
                                <pre className="font-mono text-xs sm:text-sm leading-6 text-zinc-300 whitespace-pre font-ligatures-none">
                   {generatedTree}
                 </pre>
                            )}
                        </div>

                        {/* Status Bar */}
                        {!isFullScreen && (
                            <div className="h-6 bg-[#007acc] text-white flex items-center px-3 text-[10px] justify-between shrink-0">
                                <div className="flex gap-3">
                                    <span>UTF-8</span>
                                    <span>{stats.files} files</span>
                                </div>
                                <span>{config.style.toUpperCase()}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.3); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.5); }
        .font-ligatures-none { font-variant-ligatures: none; }
      `}</style>
        </div>
    );
}
