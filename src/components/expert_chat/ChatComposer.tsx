'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SendHorizonal, ImagePlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface ChatComposerProps {
  onSend: (message: string) => void;
  onImageSelect?: (file: File) => void;
  isLoading: boolean;
}

function useAutosizeTextArea(
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  minHeight = 38,
  maxHeight = 120,
) {
  useEffect(() => {
    const el = textAreaRef.current;
    if (!el) return;

    el.style.height = `${minHeight}px`;
    const scrollHeight = el.scrollHeight;
    el.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  }, [textAreaRef, value, minHeight, maxHeight]);
}

export function ChatComposer({ onSend, onImageSelect, isLoading }: ChatComposerProps) {
  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<{ file: File; preview: string } | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useAutosizeTextArea(textAreaRef, input);

  // Cleanup preview URL on unmount or change
  useEffect(() => {
    return () => {
      if (attachedImage?.preview) {
        URL.revokeObjectURL(attachedImage.preview);
      }
    };
  }, [attachedImage]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isLoading) return;
      onSend(trimmed);
      setInput('');
      // Also pass image if attached
      if (attachedImage && onImageSelect) {
        onImageSelect(attachedImage.file);
      }
      setAttachedImage(null);
    },
    [input, isLoading, onSend, attachedImage, onImageSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleImageClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const preview = URL.createObjectURL(file);
        setAttachedImage({ file, preview });
      }
      // Reset the input so the same file can be re-selected
      e.target.value = '';
    },
    [],
  );

  const handleRemoveImage = useCallback(() => {
    if (attachedImage?.preview) {
      URL.revokeObjectURL(attachedImage.preview);
    }
    setAttachedImage(null);
  }, [attachedImage]);

  const hasContent = input.trim().length > 0 || !!attachedImage;

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="absolute bottom-4 left-0 right-0 px-3 sm:px-5 md:px-8 z-10 pointer-events-none flex justify-center"
    >
      <div className="w-full max-w-[800px] pointer-events-auto">
        <div className="bg-card/90 backdrop-blur-xl border border-border/60 shadow-lg rounded-2xl p-1 transition-all duration-200 focus-within:border-accent/40 focus-within:shadow-xl">
          {/* Image thumbnail preview */}
          <AnimatePresence>
            {attachedImage && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="px-2.5 pt-2 overflow-hidden"
              >
                <div className="relative inline-block">
                  <div className="w-16 h-16 rounded-lg overflow-hidden border border-border/60 bg-secondary">
                    <Image
                      src={attachedImage.preview}
                      alt="Attached"
                      width={64}
                      height={64}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center shadow-sm hover:bg-destructive transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input row */}
          <div className="relative flex items-end gap-1.5">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <textarea
              ref={textAreaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Περιγράψτε το έργο σας..."
              rows={1}
              className="w-full bg-transparent px-3.5 py-2.5 pr-20 text-sm resize-none focus:outline-none placeholder:text-muted-foreground/60 min-h-[40px] max-h-[120px] leading-normal chat-scrollbar-hidden"
            />
            <div className="absolute right-2 bottom-1.5 flex items-center gap-1">
              {/* Image upload button */}
              <button
                type="button"
                onClick={handleImageClick}
                className={cn(
                  'p-2 rounded-full transition-all flex items-center justify-center',
                  'text-muted-foreground hover:text-foreground hover:bg-secondary/80',
                )}
                title="Ανέβασμα εικόνας"
              >
                <ImagePlus className="w-4 h-4" />
              </button>

              {/* Send button */}
              <button
                type="submit"
                disabled={isLoading || !hasContent}
                className={cn(
                  'p-2 rounded-full transition-all flex items-center justify-center',
                  'bg-accent text-accent-foreground hover:bg-accent-light shadow-sm hover:shadow',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                <SendHorizonal className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>
        
        {/* Disclaimer */}
        <div className="mt-2 text-center flex items-center justify-center gap-1 text-[10px] text-muted-foreground/60 px-4">
          <span>Ο Ειδικός AI μπορεί να κάνει λάθη. Ελέγχετε πάντα τις προτάσεις.</span>
          <a href="/contact" className="underline hover:text-foreground transition-colors uppercase tracking-wider font-semibold ml-1">
            ΕΠΙΚΟΙΝΩΝΙΑ
          </a>
        </div>
      </div>
    </motion.form>
  );
}
