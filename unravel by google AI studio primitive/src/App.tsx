import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Code2, Github, FileText, Sparkles, AlertTriangle, ShieldCheck, 
  Search, MessageSquare, ChevronRight, Loader2, RefreshCw, FolderUp,
  BookOpen, Cpu, Terminal, FileCode, Layers, Copy, Check
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { analyzeProject, generateReport, AnalysisRawData } from './services/ai';

type ExperienceLevel = 'vibe_coder' | 'some_knowledge' | 'experienced';
type Language = 'hinglish' | 'hindi' | 'english';
type ReportType = 'plain' | 'technical' | 'prompt' | 'code' | 'all';

const PreCopyButton = ({ children }: any) => {
  const [copied, setCopied] = useState(false);
  const text = children?.props?.children || '';

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button 
      onClick={handleCopy} 
      className="absolute right-2 top-2 p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-200 rounded-md transition-all shadow-sm opacity-0 group-hover:opacity-100"
      title="Copy code"
    >
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
};

export default function App() {
  const [experience, setExperience] = useState<ExperienceLevel>('vibe_coder');
  const [language, setLanguage] = useState<Language>('hinglish');
  const [inputType, setInputType] = useState<'upload' | 'paste' | 'github'>('upload');
  const [githubUrl, setGithubUrl] = useState('');
  const [pastedCode, setPastedCode] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, string>>({});
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [rawAnalysis, setRawAnalysis] = useState<AnalysisRawData | null>(null);
  const [activeTab, setActiveTab] = useState<ReportType | null>(null);
  const [reportCache, setReportCache] = useState<Record<string, string>>({});
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: Record<string, string> = {};
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const path = file.webkitRelativePath || file.name;
      
      if (path.includes('node_modules/') || path.includes('.git/') || path.includes('dist/') || path.includes('build/')) {
        continue;
      }
      
      if (path.match(/\.(jpg|jpeg|png|gif|ico|svg|mp4|mp3|wav|zip|tar|gz|pdf|woff|woff2|ttf|eot)$/i)) {
        continue;
      }

      try {
        const text = await file.text();
        if (text.length < 100000) {
          newFiles[path] = text;
        }
      } catch (err) {
        console.warn(`Could not read file ${path}`);
      }
    }
    
    setUploadedFiles(newFiles);
  };

  const handleAnalyze = async () => {
    let inputData: any = {};

    if (inputType === 'github') {
      if (!githubUrl) return setError('Please enter a GitHub URL');
      inputData = { url: githubUrl, problem: problemDescription };
    } else if (inputType === 'paste') {
      if (!pastedCode) return setError('Please paste some code');
      inputData = { code: pastedCode, problem: problemDescription };
    } else if (inputType === 'upload') {
      if (Object.keys(uploadedFiles).length === 0) return setError('Please upload a project folder');
      inputData = { files: uploadedFiles, problem: problemDescription };
    }

    setError(null);
    setIsAnalyzing(true);
    setRawAnalysis(null);
    setReportCache({});
    setActiveTab(null);
    setProgressMsg('Initializing Trust Engine...');

    try {
      const raw = await analyzeProject(
        inputType, 
        inputData,
        (msg) => setProgressMsg(msg)
      );
      setRawAnalysis(raw);
    } catch (err: any) {
      setError(err.message || 'Something went wrong while analyzing.');
    } finally {
      setIsAnalyzing(false);
      setProgressMsg('');
    }
  };

  const loadReport = async (type: ReportType) => {
    if (!rawAnalysis) return;
    if (reportCache[type]) {
      setActiveTab(type);
      return;
    }

    setIsGeneratingReport(true);
    setActiveTab(type);
    try {
      const text = await generateReport(type, rawAnalysis, experience, language);
      setReportCache(prev => ({ ...prev, [type]: text }));
    } catch (err: any) {
      setError(err.message || 'Failed to generate this view.');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleCopyFullReport = () => {
    if (activeTab && reportCache[activeTab]) {
      navigator.clipboard.writeText(reportCache[activeTab]);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    }
  };

  const handleClear = () => {
    setRawAnalysis(null);
    setReportCache({});
    setActiveTab(null);
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-orange-200">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white font-bold">
              U
            </div>
            <h1 className="text-xl font-bold tracking-tight">Unravel</h1>
            <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Trust Engine Active
            </span>
          </div>
          <div className="text-sm text-stone-500 font-medium hidden sm:block">
            The Vibe Coder's Best Friend
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 grid md:grid-cols-[1fr_1.5fr] gap-8">
        {/* Left Column: Configuration & Input */}
        <div className="space-y-8">
          
          {/* Section 1: Who are you? */}
          <section className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-orange-500" />
              1. Tell us about yourself
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">Your Coding Experience</label>
                <div className="grid gap-2">
                  {[
                    { id: 'vibe_coder', label: 'Complete Vibe Coder', desc: 'I just use AI, no idea how code works' },
                    { id: 'some_knowledge', label: 'Know a little bit', desc: 'Can read basic HTML/JS, but get stuck easily' },
                    { id: 'experienced', label: 'Used to code', desc: 'Rusty, but I understand programming concepts' }
                  ].map((level) => (
                    <button
                      key={level.id}
                      onClick={() => setExperience(level.id as ExperienceLevel)}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        experience === level.id 
                          ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' 
                          : 'border-stone-200 hover:border-orange-300 hover:bg-stone-50'
                      }`}
                    >
                      <div className="font-medium text-stone-900">{level.label}</div>
                      <div className="text-xs text-stone-500 mt-0.5">{level.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">Preferred Language</label>
                <div className="flex gap-2">
                  {[
                    { id: 'hinglish', label: 'Hinglish' },
                    { id: 'hindi', label: 'Hindi' },
                    { id: 'english', label: 'English' }
                  ].map((lang) => (
                    <button
                      key={lang.id}
                      onClick={() => setLanguage(lang.id as Language)}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                        language === lang.id
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: What's broken? */}
          <section className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              2. What's broken?
            </h2>

            <div className="flex bg-stone-100 p-1 rounded-lg mb-4">
              <button
                onClick={() => setInputType('upload')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${
                  inputType === 'upload' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                <FolderUp className="w-4 h-4" /> Upload Folder
              </button>
              <button
                onClick={() => setInputType('paste')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${
                  inputType === 'paste' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                <FileText className="w-4 h-4" /> Paste Code
              </button>
              <button
                onClick={() => setInputType('github')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${
                  inputType === 'github' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                <Github className="w-4 h-4" /> GitHub
              </button>
            </div>

            {inputType === 'upload' && (
              <div className="mb-4">
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-stone-300 border-dashed rounded-xl cursor-pointer bg-stone-50 hover:bg-stone-100 transition-all">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <FolderUp className="w-8 h-8 text-stone-400 mb-2" />
                    <p className="text-sm text-stone-600 font-medium">Click to upload project folder</p>
                    <p className="text-xs text-stone-500 mt-1">
                      {Object.keys(uploadedFiles).length > 0 
                        ? `${Object.keys(uploadedFiles).length} files loaded` 
                        : 'node_modules & images are ignored'}
                    </p>
                  </div>
                  <input 
                    type="file" 
                    className="hidden" 
                    // @ts-ignore
                    webkitdirectory="true" 
                    directory="true" 
                    multiple 
                    onChange={handleFileUpload}
                  />
                </label>
              </div>
            )}

            {inputType === 'paste' && (
              <div className="mb-4">
                <textarea
                  value={pastedCode}
                  onChange={(e) => setPastedCode(e.target.value)}
                  placeholder="Paste your broken code here..."
                  className="w-full h-32 p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                />
              </div>
            )}
            
            {inputType === 'github' && (
              <div className="mb-4">
                <input
                  type="text"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/username/repo"
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">What's the issue? (Optional)</label>
              <textarea
                value={problemDescription}
                onChange={(e) => setProblemDescription(e.target.value)}
                placeholder="e.g., 'The login button doesn't work' or 'Just explain this to me'"
                className="w-full h-24 p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
              />
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="w-full mt-6 bg-stone-900 hover:bg-stone-800 text-white font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing your vibe...
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Unravel This Mess
                </>
              )}
            </button>
          </section>

        </div>

        {/* Right Column: Analysis Results */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col md:h-[calc(100vh-8rem)] md:sticky md:top-24 min-h-[500px]">
          <div className="p-4 border-b border-stone-100 bg-stone-50/50 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-stone-400" />
              Unravel Report
            </h2>
            {rawAnalysis && (
              <button 
                onClick={handleClear}
                className="text-xs font-medium text-stone-500 hover:text-stone-900 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          {rawAnalysis && (
            <div className="p-4 border-b border-stone-100 bg-stone-50">
              <h3 className="text-sm font-semibold text-stone-800 mb-3">Analysis Complete! What would you like to see?</h3>
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => loadReport('plain')} 
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'plain' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'}`}
                >
                  <BookOpen className="w-4 h-4" /> Plain English
                </button>
                <button 
                  onClick={() => loadReport('technical')} 
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'technical' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'}`}
                >
                  <Cpu className="w-4 h-4" /> Technical
                </button>
                <button 
                  onClick={() => loadReport('prompt')} 
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'prompt' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'}`}
                >
                  <Terminal className="w-4 h-4" /> AI Prompt
                </button>
                <button 
                  onClick={() => loadReport('code')} 
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'code' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'}`}
                >
                  <FileCode className="w-4 h-4" /> Code Fix
                </button>
                <button 
                  onClick={() => loadReport('all')} 
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'all' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'}`}
                >
                  <Layers className="w-4 h-4" /> Everything
                </button>
              </div>
            </div>
          )}
          
          <div className="flex-1 overflow-y-auto p-6 relative">
            <AnimatePresence mode="wait">
              {!isAnalyzing && !rawAnalysis && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center text-stone-400 space-y-4"
                >
                  <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center">
                    <Code2 className="w-8 h-8 text-stone-300" />
                  </div>
                  <div className="max-w-xs">
                    <p className="font-medium text-stone-600 mb-1">Ready to unravel?</p>
                    <p className="text-sm">Upload your project, and our multi-agent Trust Engine will figure out what went wrong.</p>
                  </div>
                </motion.div>
              )}

              {isAnalyzing && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center space-y-6"
                >
                  <div className="relative">
                    <div className="w-16 h-16 border-4 border-orange-100 border-t-orange-500 rounded-full animate-spin"></div>
                    <Sparkles className="w-6 h-6 text-orange-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium text-stone-900">Trust Engine is working...</p>
                    <p className="text-sm text-stone-500 animate-pulse">{progressMsg || 'Analyzing project...'}</p>
                  </div>
                </motion.div>
              )}

              {rawAnalysis && !activeTab && !isGeneratingReport && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center text-stone-400 space-y-4"
                >
                  <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center">
                    <ShieldCheck className="w-8 h-8 text-green-500" />
                  </div>
                  <div className="max-w-xs">
                    <p className="font-medium text-stone-600 mb-1">Analysis Complete!</p>
                    <p className="text-sm">Select an option above to view the results exactly how you want them.</p>
                  </div>
                </motion.div>
              )}

              {isGeneratingReport && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center space-y-4"
                >
                  <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                  <p className="text-sm text-stone-500">Generating your view...</p>
                </motion.div>
              )}

              {activeTab && reportCache[activeTab] && !isGeneratingReport && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative"
                >
                  <div className="absolute top-0 right-0 z-10">
                    <button 
                      onClick={handleCopyFullReport} 
                      className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 px-3 py-1.5 rounded-md transition-all shadow-sm"
                    >
                      {copiedReport ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedReport ? 'Copied!' : 'Copy All'}
                    </button>
                  </div>
                  <div className="prose prose-stone prose-sm sm:prose-base max-w-none
                    prose-headings:font-semibold prose-headings:tracking-tight
                    prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
                    prose-a:text-orange-600 prose-a:no-underline hover:prose-a:underline
                    prose-code:text-orange-600 prose-code:bg-orange-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                    prose-pre:bg-stone-900 prose-pre:text-stone-50 prose-pre:p-4 prose-pre:rounded-xl
                    marker:text-orange-500 pt-8"
                  >
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre({ node, children, ...props }) {
                          return (
                            <div className="relative group my-4">
                              <PreCopyButton>{children}</PreCopyButton>
                              <pre {...props}>{children}</pre>
                            </div>
                          );
                        }
                      }}
                    >
                      {reportCache[activeTab]}
                    </ReactMarkdown>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <footer className="border-t border-stone-200 mt-12 py-8 text-center text-sm text-stone-500">
        <p>Built for the Vibe Coders of India 🇮🇳</p>
      </footer>
    </div>
  );
}
