import { Component, type ErrorInfo, type ReactNode } from "react";
import { createLogger } from "../lib/logger";

const log = createLogger("ErrorBoundary");

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error(
      `React component crash: ${error.message}\n${error.stack ?? ""}\nComponent stack: ${info.componentStack ?? ""}`,
    );
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-lg text-center">
            <h2 className="text-lg font-semibold text-slate-200 mb-2">
              程序遇到了意外错误
            </h2>
            <p className="text-sm text-slate-400 mb-1">
              错误详情已记录至日志文件，重启应用后即可恢复正常。
            </p>
            <p className="text-xs text-slate-500 mb-4">
              如果问题持续出现，请将日志目录中的最新日志文件反馈给开发者。
            </p>
            <pre className="text-left text-xs text-red-400 bg-slate-900 rounded p-3 mb-4 max-h-32 overflow-auto">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded cursor-pointer transition-colors"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
