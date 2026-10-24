import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function ConfirmModal({
  isOpen,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isDanger = false,
  isLoading = false,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#263B2B]/40 backdrop-blur-2xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-[#F7FAF6] border border-[#D4E0D5] rounded-2xl p-6 shadow-xl relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="absolute top-4 right-4 text-[#627466] hover:text-[#263B2B] p-1 rounded-lg transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-4">
          <div
            className={`p-3 rounded-xl flex-shrink-0 ${
              isDanger
                ? 'bg-[#FDEAE9] text-[#7B2422] border border-[#F5B7B5]'
                : 'bg-[#DCE8DD] text-[#37553A] border border-[#AEC3B0]'
            }`}
          >
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div className="flex-1">
            <h3 className="text-lg font-bold text-[#263B2B]">{title}</h3>
            <p className="mt-2 text-sm text-[#627466] leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-[#D4E0D5]">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-semibold text-[#263B2B] bg-[#DCE8DD] hover:bg-[#C8DBC9] rounded-xl transition border border-[#D4E0D5]"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition flex items-center gap-2 shadow-2xs ${
              isDanger
                ? 'bg-[#C2413E] hover:bg-[#A83230] text-white'
                : 'bg-[#37553A] hover:bg-[#2A422D] text-white'
            } disabled:opacity-50`}
          >
            {isLoading && (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
