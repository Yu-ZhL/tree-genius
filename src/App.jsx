import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Folder, FileText, Copy, Settings, Trash2, Plus,
    Download, RefreshCw, Layers, Code, Play, Square,
    Loader2, HardDrive, FileJson
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
        vertical: '  ', // 使用空格保持层级
        space: '  '
    },
    indent: {
        branch: '  ',
        lastBranch: '  ',
        vertical: '  ', // 关键修复：即使没有连接线，也需要空格占位来体现缩进
        space: '  '
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

// 格式化文件大小
const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function App() {
    // --- State ---
    const [fileList, setFileList] = useState([]); // 存储原始 File 对象数组
    const [rootName, setRootName] = useState('project-root');

    // 生成结果 State
    const [generatedTree, setGeneratedTree] = useState('');
    const [stats, setStats] = useState({ dirs: 0, files: 0, totalSize: 0 });
    const [isGenerating, setIsGenerating] = useState(false);
    const [isCopied, setIsCopied] = useState(false);

    // 这里的 Ref 用于中断生成过程
    const abortControllerRef = useRef(null);

    // --- 配置 State (带持久化) ---
    const [config, setConfig] = useState(() => {
        // 初始加载时读取 localStorage
        const saved = localStorage.getItem('tree-genius-config-v2');
        return saved ? JSON.parse(saved) : {
            maxDepth: 10,
            style: 'classic',
            ignores: [...DEFAULT_IGNORES],
            showFiles: true,
            showSizes: false, // 新功能：显示大小
            trailingSlash: false,
            showStats: true   // 新功能：显示统计信息
        };
    });

    const [ignoreInput, setIgnoreInput] = useState('');

    // --- Effects ---

    // 1. 自动保存配置
    useEffect(() => {
        localStorage.setItem('tree-genius-config-v2', JSON.stringify(config));
    }, [config]);

    // 2. 核心生成逻辑触发器
    useEffect(() => {
        if (fileList.length === 0) return;

        // 使用防抖或简单的异步调用来避免阻塞 UI，并支持取消
        const generate = async () => {
            // 如果有正在进行的任务，先取消
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }

            const controller = new AbortController();
            abortControllerRef.current = controller;
            const signal = controller.signal;

            setIsGenerating(true);

            try {
                // 模拟让出主线程，允许 UI 渲染 "Loading" 状态
                await new Promise(resolve => setTimeout(resolve, 10));

                if (signal.aborted) return;

                // 开始构建
                const { treeString, statistics } = await buildTreeAsync(fileList, config, rootName, signal);

                if (!signal.aborted) {
                    setGeneratedTree(treeString);
                    setStats(statistics);
                }
            } catch (err) {
                if (err.message !== 'Aborted') {
                    console.error("Tree generation failed:", err);
                    setGeneratedTree(`Error: ${err.message}`);
                }
            } finally {
                if (!signal.aborted) {
                    setIsGenerating(false);
                    abortControllerRef.current = null;
                }
            }
        };

        generate();

        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, [fileList, config, rootName]);


    // --- 逻辑函数 ---

    // 异步构建树（模拟耗时操作）
    const buildTreeAsync = async (files, cfg, root, signal) => {
        // 1. 预处理：构建路径映射对象
        const tree = {};
        const stats = { dirs: 0, files: 0, totalSize: 0 };

        // 为了不阻塞，我们每处理一定数量的文件就 yield 一次
        const CHUNK_SIZE = 2000;

        for (let i = 0; i < files.length; i++) {
            if (i % CHUNK_SIZE === 0) {
                await new Promise(r => setTimeout(r, 0)); // Yield to main thread
                if (signal.aborted) throw new Error('Aborted');
            }

            const file = files[i];
            const path = file.webkitRelativePath || file.name;
            const parts = path.split('/');
            // parts[0] 是根文件夹名，通常不包含在树的子节点里，但 webkitRelativePath 包含它
            const relevantParts = parts.slice(1);

            // 过滤
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

                if (!isFile) {
                    currentLevel = currentLevel[part]._children;
                }
            });
        }

        // 2. 渲染字符串
        let resultString = '';

        if (cfg.style === 'json') {
            resultString = JSON.stringify(tree, null, 2);
        } else {
            const rootLabel = cfg.trailingSlash ? `${root}/` : root;
            const rootSizeInfo = cfg.showSizes ? ` (${formatSize(stats.totalSize)})` : '';

            // 只有在非 indent 模式或者 indent 模式下第一行通常也显示根
            resultString = `${rootLabel}${rootSizeInfo}\n`;
            resultString += await renderNodes(tree, '', 0, cfg, signal);
        }

        return { treeString: resultString, statistics: stats };
    };

    const renderNodes = async (nodes, prefix, depth, cfg, signal) => {
        if (depth >= cfg.maxDepth) return '';
        if (signal.aborted) throw new Error('Aborted');

        let output = '';
        const entries = Object.entries(nodes).sort((a, b) => {
            // 文件夹排前面
            const aIsDir = a[1]._type === 'dir';
            const bIsDir = b[1]._type === 'dir';
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a[0].localeCompare(b[0]);
        });

        const style = TREE_STYLES[cfg.style] || TREE_STYLES.classic;

        for (let i = 0; i < entries.length; i++) {
            // 定期 yield 防止大树渲染卡死
            if (i % 500 === 0) await new Promise(r => setTimeout(r, 0));

            const [name, data] = entries[i];
            const isLast = i === entries.length - 1;
            const isDir = data._type === 'dir';

            if (!cfg.showFiles && !isDir) continue;

            // 准备前缀和连接符
            let connector = isLast ? style.lastBranch : style.branch;

            // Emoji 风格特殊处理
            let icon = '';
            if (cfg.style === 'emoji') {
                icon = isDir ? style.folderIcon : style.fileIcon;
            }

            let lineContent = name;
            if (isDir && cfg.trailingSlash) lineContent += '/';

            // 添加大小信息
            if (cfg.showSizes && !isDir) {
                lineContent += ` (${formatSize(data.size)})`;
            }

            output += `${prefix}${connector}${icon}${lineContent}\n`;

            if (isDir) {
                const nextPrefix = prefix + (isLast ? style.space : style.vertical);
                output += await renderNodes(data._children, nextPrefix, depth + 1, cfg, signal);
            }
        }

        return output;
    };

    // --- 事件处理 ---

    const handleFolderSelect = (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        // 转换为数组以便后续处理
        const fileArray = Array.from(files);
        setFileList(fileArray);

        const firstPath = fileArray[0].webkitRelativePath;
        if (firstPath) {
            setRootName(firstPath.split('/')[0]);
        }
    };

    const stopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setIsGenerating(false);
            setGeneratedTree(prev => prev + '\n\n[已手动终止生成]');
        }
    };

    const copyToClipboard = () => {
        const textArea = document.createElement("textarea");
        textArea.value = generatedTree;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
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
        URL.revokeObjectURL(url);
    };

    const resetConfig = () => {
        if (confirm('恢复默认设置？')) {
            setConfig({
                maxDepth: 10, style: 'classic', ignores: [...DEFAULT_IGNORES],
                showFiles: true, showSizes: false, trailingSlash: false, showStats: true
            });
            localStorage.removeItem('tree-genius-config-v2');
        }
    };

    // 辅助组件：开关
    const Toggle = ({ label, checked, onChange }) => (
        <div className="flex items-center justify-between py-1">
            <span className="text-sm text-slate-600">{label}</span>
            <button
                onClick={() => onChange(!checked)}
                className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
            >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
            </button>
        </div>
    );

    return (
        <div className="h-screen bg-slate-50 text-slate-800 font-sans flex flex-col md:flex-row overflow-hidden">

            {/* 左侧控制栏 */}
            <div className="w-full md:w-80 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col h-full z-20 shadow-lg">
                {/* Header */}
                <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-blue-700 to-indigo-800 text-white flex justify-between items-center">
                    <div className="flex items-center gap-2 font-bold text-lg">
                        <Layers className="text-blue-200" size={20} />
                        TreeGenius <span className="text-xs bg-white/20 px-1.5 rounded font-normal">PRO</span>
                    </div>
                    <button onClick={resetConfig} title="重置设置" className="hover:bg-white/10 p-1 rounded">
                        <RefreshCw size={14} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">

                    {/* 1. 文件导入 */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">项目导入</label>
                        <div className="relative group cursor-pointer">
                            <input
                                type="file"
                                webkitdirectory=""
                                directory=""
                                multiple
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                onChange={handleFolderSelect}
                            />
                            <div className="border-2 border-dashed border-blue-200 bg-blue-50/50 rounded-xl p-4 text-center group-hover:bg-blue-50 group-hover:border-blue-400 transition-all">
                                <Folder className="mx-auto text-blue-500 mb-2" size={24} />
                                <p className="text-sm font-medium text-blue-700">点击选择文件夹</p>
                                {fileList.length > 0 ? (
                                    <p className="text-xs text-green-600 mt-1 font-mono">已载入 {rootName}</p>
                                ) : (
                                    <p className="text-xs text-slate-400 mt-1">支持拖拽或点击</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 2. 核心设置 */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">展示风格</label>
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
                                    className={`text-xs py-2 px-2 rounded border transition-all ${
                                        config.style === opt.id
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        <div className="pt-2">
                            <div className="flex justify-between text-xs text-slate-500 mb-1">
                                <span>深度限制</span>
                                <span>{config.maxDepth} 层</span>
                            </div>
                            <input
                                type="range" min="1" max="15" step="1"
                                value={config.maxDepth}
                                onChange={(e) => setConfig({...config, maxDepth: parseInt(e.target.value)})}
                                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                        </div>
                    </div>

                    {/* 3. 开关选项 */}
                    <div className="space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <Toggle label="显示文件" checked={config.showFiles} onChange={v => setConfig({...config, showFiles: v})} />
                        <Toggle label="显示大小 (KB)" checked={config.showSizes} onChange={v => setConfig({...config, showSizes: v})} />
                        <Toggle label="文件夹尾部斜杠 (/)" checked={config.trailingSlash} onChange={v => setConfig({...config, trailingSlash: v})} />
                        <Toggle label="显示统计信息" checked={config.showStats} onChange={v => setConfig({...config, showStats: v})} />
                    </div>

                    {/* 4. 排除设置 */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">排除名单</label>
                        <div className="flex gap-1">
                            <input
                                type="text"
                                value={ignoreInput}
                                onChange={e => setIgnoreInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && setConfig(c => ({...c, ignores: [...c.ignores, ignoreInput] }) || setIgnoreInput(''))}
                                placeholder="添加目录 (如 test)..."
                                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded focus:border-blue-500 focus:outline-none"
                            />
                            <button
                                onClick={() => { if(ignoreInput) { setConfig(c => ({...c, ignores: [...c.ignores, ignoreInput] })); setIgnoreInput(''); }}}
                                className="bg-slate-100 px-3 rounded text-slate-600 hover:bg-slate-200"
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {config.ignores.map(item => (
                                <span key={item} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 text-slate-600 text-xs rounded hover:border-red-300 group transition-colors">
                  {item}
                                    <button onClick={() => setConfig(c => ({...c, ignores: c.ignores.filter(i => i !== item)}))} className="text-slate-400 group-hover:text-red-500">
                    <Trash2 size={10} />
                  </button>
                </span>
                            ))}
                        </div>
                    </div>

                </div>
            </div>

            {/* 右侧预览区 */}
            <div className="flex-1 flex flex-col min-w-0 bg-slate-100">

                {/* Toolbar */}
                <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shadow-sm z-10">
                    <div className="flex items-center gap-4 min-w-0">
                        {isGenerating ? (
                            <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full text-sm font-medium animate-pulse">
                                <Loader2 className="animate-spin" size={16} />
                                <span>Generating...</span>
                                <button onClick={stopGeneration} className="ml-2 bg-white text-red-500 text-xs px-2 py-0.5 rounded border border-blue-100 hover:bg-red-50 hover:border-red-200">
                                    停止
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-4 text-slate-500 text-sm">
                                {config.showStats && fileList.length > 0 && (
                                    <>
                                        <span className="flex items-center gap-1"><Folder size={14} /> {stats.dirs} 文件夹</span>
                                        <span className="flex items-center gap-1"><FileText size={14} /> {stats.files} 文件</span>
                                        <span className="flex items-center gap-1"><HardDrive size={14} /> {formatSize(stats.totalSize)}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={downloadFile}
                            disabled={!generatedTree}
                            className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="下载 .txt"
                        >
                            <Download size={18} />
                        </button>
                        <button
                            onClick={copyToClipboard}
                            disabled={!generatedTree}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                                isCopied
                                    ? 'bg-green-600 text-white shadow-green-200'
                                    : 'bg-slate-800 text-white hover:bg-slate-900 shadow-slate-300'
                            }`}
                        >
                            {isCopied ? '已复制!' : <><Copy size={16}/> 复制结果</>}
                        </button>
                    </div>
                </div>

                {/* Editor Area */}
                <div className="flex-1 p-4 md:p-6 overflow-hidden relative flex flex-col">
                    <div className="flex-1 bg-[#1e1e1e] rounded-xl shadow-2xl overflow-hidden flex flex-col border border-slate-700/50">
                        {/* Mac Toolbar */}
                        <div className="h-8 bg-[#2d2d2d] flex items-center px-4 gap-2 border-b border-black/20 shrink-0">
                            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
                            <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                            <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
                            <span className="ml-3 text-xs text-zinc-500 font-mono">
                 {rootName}.{config.style === 'json' ? 'json' : 'txt'}
               </span>
                        </div>

                        <div className="flex-1 overflow-auto p-4 custom-scrollbar relative">
                            {!fileList.length ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 opacity-30 select-none">
                                    <Code size={80} strokeWidth={1} />
                                    <p className="mt-4 text-xl font-light">等待导入项目...</p>
                                </div>
                            ) : (
                                <pre className="font-mono text-sm leading-6 text-zinc-300 whitespace-pre font-ligatures-none">
                   {generatedTree}
                 </pre>
                            )}
                        </div>

                        {/* Footer Status */}
                        <div className="h-7 bg-[#007acc] text-white flex items-center px-3 text-[10px] justify-between shrink-0">
                            <span>UTF-8</span>
                            <span>{config.style.toUpperCase()} MODE</span>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        .font-ligatures-none { font-variant-ligatures: none; }
      `}</style>
        </div>
    );
}
