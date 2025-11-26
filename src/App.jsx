import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Folder,
    FileText,
    Copy,
    Settings,
    Trash2,
    Plus,
    History,
    Download,
    RefreshCw,
    ChevronRight,
    ChevronDown,
    Layers,
    Code
} from 'lucide-react';

// --- 工具函数 ---

// 默认排除列表
const DEFAULT_IGNORES = [
    'node_modules',
    '.git',
    '.idea',
    '.vscode',
    'dist',
    'build',
    'coverage',
    '__pycache__',
    '.DS_Store'
];

// 树的样式定义
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
    indent: {
        branch: '',
        lastBranch: '',
        vertical: '',
        space: '  '
    }
};

export default function App() {
    // --- State ---
    const [files, setFiles] = useState([]);
    const [rootName, setRootName] = useState('project-root');
    const [generatedTree, setGeneratedTree] = useState('');
    const [isCopied, setIsCopied] = useState(false);

    // 配置 State
    const [config, setConfig] = useState({
        maxDepth: 10,
        style: 'classic', // classic, ascii, minimal, indent, json
        ignores: [...DEFAULT_IGNORES],
        showFiles: true,
        showIcons: true, // 仅影响预览，不影响生成的文本
        trailingSlash: false, // 文件夹后是否加 /
    });

    const [ignoreInput, setIgnoreInput] = useState('');
    const [isSettingsOpen, setIsSettingsOpen] = useState(true); // 移动端默认折叠可能更好，这里桌面端默认展开

    // --- Effects ---

    // 从 LocalStorage 加载配置
    useEffect(() => {
        const savedConfig = localStorage.getItem('tree-genius-config');
        if (savedConfig) {
            try {
                const parsed = JSON.parse(savedConfig);
                // 合并配置，防止新版本缺少字段
                setConfig(prev => ({ ...prev, ...parsed }));
            } catch (e) {
                console.error("Failed to load config", e);
            }
        }
    }, []);

    // 保存配置到 LocalStorage
    useEffect(() => {
        localStorage.setItem('tree-genius-config', JSON.stringify(config));
    }, [config]);

    // --- 核心逻辑：处理文件输入 ---

    const handleFolderSelect = (e) => {
        const fileList = e.target.files;
        if (!fileList || fileList.length === 0) return;

        // 获取根文件夹名称 (取第一个文件的路径的第一部分)
        // webkitRelativePath 格式通常是 "FolderName/subfolder/file.txt"
        const firstPath = fileList[0].webkitRelativePath;
        const root = firstPath.split('/')[0];
        setRootName(root);

        const paths = [];
        for (let i = 0; i < fileList.length; i++) {
            paths.push(fileList[i].webkitRelativePath);
        }
        setFiles(paths);
    };

    // --- 核心逻辑：构建树结构 ---

    // 1. 将路径数组转换为嵌套对象
    const buildFileTree = (paths) => {
        const tree = {};

        paths.forEach(path => {
            const parts = path.split('/');
            // 移除第一层（根目录名），因为我们通常从根目录内部开始展示
            // 但如果用户上传的是多个文件而非文件夹，这里的逻辑可能需要调整。
            // 对于 webkitdirectory，parts[0] 总是文件夹名。
            const relevantParts = parts.slice(1);

            // 过滤逻辑 (Pre-filter)
            // 如果路径中任何一部分在 ignores 列表中，则丢弃该路径
            const shouldIgnore = relevantParts.some(part => config.ignores.includes(part));
            if (shouldIgnore) return;

            let currentLevel = tree;
            relevantParts.forEach((part, index) => {
                if (!currentLevel[part]) {
                    currentLevel[part] = index === relevantParts.length - 1 ? null : {};
                }
                currentLevel = currentLevel[part];
            });
        });
        return tree;
    };

    // 2. 将嵌套对象递归渲染为字符串
    const renderTreeString = (tree, prefix = '', depth = 0) => {
        if (depth >= config.maxDepth) return '';

        // JSON 模式单独处理
        if (config.style === 'json') return '';

        let output = '';
        const keys = Object.keys(tree).sort((a, b) => {
            // 文件夹排在文件前面
            const aIsFolder = tree[a] !== null;
            const bIsFolder = tree[b] !== null;
            if (aIsFolder && !bIsFolder) return -1;
            if (!aIsFolder && bIsFolder) return 1;
            return a.localeCompare(b);
        });

        const style = TREE_STYLES[config.style] || TREE_STYLES.classic;

        keys.forEach((key, index) => {
            const isLast = index === keys.length - 1;
            const isFolder = tree[key] !== null;

            // 如果不显示文件且当前是文件，跳过
            if (!config.showFiles && !isFolder) return;

            const connector = isLast ? style.lastBranch : style.branch;

            let lineName = key;
            if (isFolder && config.trailingSlash) lineName += '/';

            output += `${prefix}${connector}${lineName}\n`;

            if (isFolder) {
                const nextPrefix = prefix + (isLast ? style.space : style.vertical);
                output += renderTreeString(tree[key], nextPrefix, depth + 1);
            }
        });

        return output;
    };

    // 3. 将嵌套对象转换为 JSON 字符串
    const renderJsonString = (tree) => {
        // 简单的递归转换，为了美观可以做更多处理
        return JSON.stringify(tree, null, 2);
    };

    // 使用 useMemo 优化性能，只有当文件列表或配置改变时才重新计算
    useEffect(() => {
        if (files.length === 0) return;

        const treeObj = buildFileTree(files);

        let resultString = '';

        if (config.style === 'json') {
            resultString = renderJsonString(treeObj);
        } else {
            // 添加根目录
            const rootDisplay = config.trailingSlash ? `${rootName}/` : rootName;
            resultString = `${rootDisplay}\n` + renderTreeString(treeObj);
        }

        setGeneratedTree(resultString);
    }, [files, config, rootName]);


    // --- 交互处理 ---

    const copyToClipboard = () => {
        // 使用 execCommand 作为 fallback 或直接使用 navigator
        const textArea = document.createElement("textarea");
        textArea.value = generatedTree;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);

        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    const addIgnore = () => {
        if (ignoreInput && !config.ignores.includes(ignoreInput)) {
            setConfig(prev => ({
                ...prev,
                ignores: [...prev.ignores, ignoreInput]
            }));
            setIgnoreInput('');
        }
    };

    const removeIgnore = (item) => {
        setConfig(prev => ({
            ...prev,
            ignores: prev.ignores.filter(i => i !== item)
        }));
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') addIgnore();
    };

    const clearHistory = () => {
        if(confirm('确定恢复默认设置吗？')) {
            setConfig({
                maxDepth: 10,
                style: 'classic',
                ignores: [...DEFAULT_IGNORES],
                showFiles: true,
                showIcons: true,
                trailingSlash: false,
            });
            localStorage.removeItem('tree-genius-config');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col md:flex-row">

            {/* 左侧控制面板 */}
            <div className="w-full md:w-80 lg:w-96 bg-white border-r border-slate-200 flex flex-col h-screen overflow-hidden shadow-lg z-10">
                {/* Header */}
                <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                    <div className="flex items-center gap-2">
                        <Layers size={24} />
                        <h1 className="font-bold text-xl tracking-tight">TreeGenius</h1>
                    </div>
                    <div className="text-xs bg-blue-800 px-2 py-0.5 rounded opacity-80">v1.0</div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-8">

                    {/* 1. 文件选择区域 */}
                    <div className="space-y-3">
                        <label className="block text-sm font-semibold text-slate-700 uppercase tracking-wider">
                            1. 选择项目文件夹
                        </label>
                        <div className="relative group">
                            <input
                                type="file"
                                webkitdirectory=""
                                directory=""
                                multiple
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                onChange={handleFolderSelect}
                            />
                            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center transition-all group-hover:border-blue-500 group-hover:bg-blue-50">
                                <div className="flex justify-center mb-2">
                                    <Folder size={32} className="text-blue-500" />
                                </div>
                                <p className="text-sm font-medium text-slate-600 group-hover:text-blue-600">
                                    点击选择文件夹
                                </p>
                                <p className="text-xs text-slate-400 mt-1">
                                    (数据仅在本地处理，不会上传)
                                </p>
                            </div>
                        </div>
                        {files.length > 0 && (
                            <div className="flex items-center justify-between text-xs text-green-600 bg-green-50 px-3 py-2 rounded-md border border-green-100">
                                <span>已加载: {rootName}</span>
                                <span className="font-bold">{files.length} 个文件</span>
                            </div>
                        )}
                    </div>

                    {/* 2. 格式设置 */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="block text-sm font-semibold text-slate-700 uppercase tracking-wider">
                                2. 展示格式
                            </label>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { id: 'classic', label: '标准树 (Classic)' },
                                { id: 'ascii', label: 'ASCII 纯文本' },
                                { id: 'minimal', label: '极简 (+ / -)' },
                                { id: 'indent', label: '仅缩进' },
                                { id: 'json', label: 'JSON 格式' }
                            ].map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => setConfig(c => ({ ...c, style: opt.id }))}
                                    className={`text-sm py-2 px-3 rounded-md border text-left transition-all ${
                                        config.style === opt.id
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        <div className="space-y-3 pt-2">
                            {/* 深度滑块 */}
                            <div className="space-y-1">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">显示深度</span>
                                    <span className="font-mono font-bold text-blue-600">{config.maxDepth} 层</span>
                                </div>
                                <input
                                    type="range"
                                    min="1"
                                    max="20"
                                    step="1"
                                    value={config.maxDepth}
                                    onChange={(e) => setConfig(c => ({ ...c, maxDepth: parseInt(e.target.value) }))}
                                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                />
                            </div>

                            {/* 开关选项 */}
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-600">显示文件名</span>
                                <button
                                    onClick={() => setConfig(c => ({ ...c, showFiles: !c.showFiles }))}
                                    className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${config.showFiles ? 'bg-blue-600' : 'bg-slate-300'}`}
                                >
                                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${config.showFiles ? 'translate-x-5' : ''}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-600">文件夹尾部斜杠 (/)</span>
                                <button
                                    onClick={() => setConfig(c => ({ ...c, trailingSlash: !c.trailingSlash }))}
                                    className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${config.trailingSlash ? 'bg-blue-600' : 'bg-slate-300'}`}
                                >
                                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${config.trailingSlash ? 'translate-x-5' : ''}`} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 3. 排除项设置 */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="block text-sm font-semibold text-slate-700 uppercase tracking-wider">
                                3. 排除名单
                            </label>
                            <button onClick={clearHistory} title="恢复默认" className="text-slate-400 hover:text-red-500 transition-colors">
                                <RefreshCw size={14} />
                            </button>
                        </div>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={ignoreInput}
                                onChange={(e) => setIgnoreInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="输入名称并回车 (如 dist)"
                                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                                onClick={addIgnore}
                                className="bg-slate-100 text-slate-600 p-2 rounded-md hover:bg-slate-200"
                            >
                                <Plus size={18} />
                            </button>
                        </div>

                        <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                            {config.ignores.map(item => (
                                <span key={item} className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 text-xs rounded-full border border-red-100 group">
                  {item}
                                    <button onClick={() => removeIgnore(item)} className="hover:text-red-900">
                    <Trash2 size={10} />
                  </button>
                </span>
                            ))}
                        </div>
                    </div>

                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50 text-xs text-center text-slate-400">
                    Settings saved automatically
                </div>
            </div>

            {/* 右侧展示区域 */}
            <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-50/50">

                {/* Toolbar */}
                <div className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6 shadow-sm z-10">
                    <div className="flex items-center gap-2 text-slate-500">
                        {files.length === 0 ? (
                            <span className="flex items-center gap-2"><FileText size={16}/> 等待文件导入...</span>
                        ) : (
                            <span className="flex items-center gap-2 text-slate-800 font-medium"><FileText size={16}/> 预览生成结果</span>
                        )}
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={copyToClipboard}
                            disabled={!generatedTree}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all shadow-sm ${
                                isCopied
                                    ? 'bg-green-600 text-white shadow-green-200'
                                    : generatedTree
                                        ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200 hover:shadow-md'
                                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                            {isCopied ? <span className="flex items-center gap-2">已复制!</span> : <><Copy size={16}/> 复制文本</>}
                        </button>
                    </div>
                </div>

                {/* Code Editor Area */}
                <div className="flex-1 p-6 overflow-hidden relative">
                    <div className="absolute inset-0 m-6 bg-slate-900 rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-800">
                        {/* Fake Mac Toolbar */}
                        <div className="h-9 bg-slate-800 flex items-center px-4 gap-2 select-none border-b border-slate-700">
                            <div className="w-3 h-3 rounded-full bg-red-500" />
                            <div className="w-3 h-3 rounded-full bg-yellow-500" />
                            <div className="w-3 h-3 rounded-full bg-green-500" />
                            <span className="ml-4 text-xs text-slate-400 font-mono opacity-60">tree_output.txt</span>
                        </div>

                        <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                            {files.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-40">
                                    <Code size={64} className="mb-4" />
                                    <p className="text-lg">在左侧选择一个文件夹以开始</p>
                                    <p className="text-sm">Folder path structure will appear here</p>
                                </div>
                            ) : (
                                <pre className="font-mono text-sm leading-relaxed text-slate-300 whitespace-pre">
                   {generatedTree}
                 </pre>
                            )}
                        </div>

                        {/* Stats Footer */}
                        {generatedTree && (
                            <div className="h-8 bg-slate-800 border-t border-slate-700 flex items-center justify-between px-4 text-xs text-slate-500 font-mono">
                                <span>Lines: {generatedTree.split('\n').length}</span>
                                <span>Chars: {generatedTree.length}</span>
                                <span>Format: {config.style}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1e293b;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #475569;
          border-radius: 5px;
          border: 2px solid #1e293b;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #64748b;
        }
      `}</style>
        </div>
    );
}
