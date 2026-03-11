/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot,
  Timestamp,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, QuestionHistory, FREE_LIMITS } from './types';
import { askGemini } from './services/geminiService';
import { 
  BookOpen, 
  Camera, 
  Send, 
  History, 
  Crown, 
  LogOut, 
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  CreditCard,
  RefreshCw,
  LayoutDashboard,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import ReactMarkdown from 'react-markdown';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
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
        <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-zinc-400 mb-6 max-w-md">
            {this.state.error?.message.includes('permission-denied') 
              ? "You don't have permission to access this data. Please check your account status."
              : "An unexpected error occurred. Please try refreshing the page."}
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-emerald-500 text-black font-bold rounded-2xl flex items-center gap-2"
          >
            <RefreshCw className="w-5 h-5" />
            Refresh App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<QuestionHistory[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [showPremium, setShowPremium] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [allQuestions, setAllQuestions] = useState<QuestionHistory[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.email === 'aimlock463@gmail.com';

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
          setError("Firebase connection failed. Please check your configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          await syncProfile(firebaseUser);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setProfile(null);
        setQuestions([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Questions Listener
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'questions'),
      where('uid', '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as QuestionHistory[];
      setQuestions(history);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'questions');
    });
    return () => unsubscribe();
  }, [user]);

  // Admin: All Questions Listener
  useEffect(() => {
    if (!user || !isAdmin) return;
    const q = query(
      collection(db, 'questions'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as QuestionHistory[];
      setAllQuestions(history);
    }, (err) => {
      console.error("Admin List Error:", err);
    });
    return () => unsubscribe();
  }, [user, isAdmin]);

  const syncProfile = async (firebaseUser: User) => {
    const userRef = doc(db, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userRef);
    const today = new Date().toISOString().split('T')[0];

    if (userSnap.exists()) {
      const data = userSnap.data() as UserProfile;
      if (data.lastResetDate !== today) {
        const updatedProfile = {
          ...data,
          questionsAskedToday: 0,
          questionsWrittenToday: 0,
          photosUploadedToday: 0,
          lastResetDate: today
        };
        await updateDoc(userRef, updatedProfile);
        setProfile(updatedProfile);
      } else {
        setProfile(data);
      }
    } else {
      const newProfile: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        isPremium: false,
        questionsAskedToday: 0,
        questionsWrittenToday: 0,
        photosUploadedToday: 0,
        lastResetDate: today
      };
      await setDoc(userRef, newProfile);
      setProfile(newProfile);
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError('Failed to sign in. Please try again.');
    }
  };

  const handleLogout = () => signOut(auth);

  const onDrop = (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: false
  });

  const checkLimits = () => {
    if (!profile) return false;
    if (profile.isPremium) return true;

    if (profile.questionsAskedToday >= FREE_LIMITS.QUESTIONS) {
      setError('Daily question limit reached. Upgrade to Premium for unlimited access!');
      return false;
    }
    if (input.length > 0 && profile.questionsWrittenToday >= FREE_LIMITS.WRITTEN) {
      setError('Daily written question limit reached. Upgrade to Premium!');
      return false;
    }
    if (image && profile.photosUploadedToday >= FREE_LIMITS.PHOTOS) {
      setError('Daily photo upload limit reached. Upgrade to Premium!');
      return false;
    }
    return true;
  };

  const handleAsk = async () => {
    if (!user || !profile) return;
    if (!input && !image) return;
    if (!checkLimits()) return;

    setIsAsking(true);
    setError(null);

    try {
      const base64Image = image ? image.split(',')[1] : undefined;
      const answer = await askGemini(input || "What is in this image?", base64Image);

      await addDoc(collection(db, 'questions'), {
        uid: user.uid,
        question: input || "Image analysis",
        answer,
        imageUrl: image,
        timestamp: serverTimestamp()
      });

      const userRef = doc(db, 'users', user.uid);
      const updates: any = {
        questionsAskedToday: profile.questionsAskedToday + 1,
      };
      if (input) updates.questionsWrittenToday = (profile.questionsWrittenToday || 0) + 1;
      if (image) updates.photosUploadedToday = (profile.photosUploadedToday || 0) + 1;

      await updateDoc(userRef, updates);
      setProfile(prev => prev ? { ...prev, ...updates } : null);
      
      setInput('');
      setImage(null);
    } catch (err) {
      console.error("Ask Gemini Error:", err);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsAsking(false);
    }
  };

  const handleUpgrade = async () => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { isPremium: true });
      setProfile(prev => prev ? { ...prev, isPremium: true } : null);
      setShowPremium(false);
      setShowSuccess(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center p-6 overflow-hidden relative">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8 z-10"
        >
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center border border-emerald-500/20">
              <BookOpen className="w-10 h-10 text-emerald-500" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">AI Tutor Pro</h1>
            <p className="text-zinc-400">Your personal AI-powered homework helper and tutor.</p>
            <p className="text-emerald-500 font-medium pt-2">Made by Ali</p>
          </div>
          <button
            onClick={handleLogin}
            className="w-full py-4 bg-white text-black font-semibold rounded-2xl hover:bg-zinc-200 transition-colors flex items-center justify-center gap-3"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>
          <p className="text-xs text-zinc-500">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </motion.div>
        
        {/* Ali Alright Style Animation */}
        <div className="absolute inset-0 pointer-events-none">
          <motion.div 
            animate={{ 
              scale: [1, 1.2, 1],
              x: [0, 50, 0],
              y: [0, 30, 0],
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="absolute -top-20 -left-20 w-[500px] h-[500px] bg-emerald-500/20 blur-[120px] rounded-full"
          />
          <motion.div 
            animate={{ 
              scale: [1.2, 1, 1.2],
              x: [0, -50, 0],
              y: [0, -30, 0],
            }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
            className="absolute -bottom-20 -right-20 w-[600px] h-[600px] bg-blue-500/10 blur-[140px] rounded-full"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-black/50 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-emerald-500" />
            <span className="font-bold text-lg">AI Tutor Pro</span>
          </div>
          
          <div className="flex items-center gap-4">
            {isAdmin && (
              <button 
                onClick={() => setShowAdmin(true)}
                className="flex items-center gap-2 px-4 py-1.5 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full text-sm font-medium hover:bg-blue-500/20 transition-colors"
              >
                <LayoutDashboard className="w-4 h-4" />
                Admin
              </button>
            )}
            {!profile?.isPremium && (
              <button 
                onClick={() => setShowPremium(true)}
                className="hidden sm:flex items-center gap-2 px-4 py-1.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full text-sm font-medium hover:bg-emerald-500/20 transition-colors"
              >
                <Crown className="w-4 h-4" />
                Go Premium
              </button>
            )}
            <button 
              onClick={() => setShowHistory(true)}
              className="p-2 text-zinc-400 hover:text-white transition-colors"
            >
              <History className="w-5 h-5" />
            </button>
            <div className="h-8 w-px bg-zinc-800 mx-1" />
            <button 
              onClick={handleLogout}
              className="p-2 text-zinc-400 hover:text-white transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 space-y-8">
        {/* Limits Display */}
        {!profile?.isPremium && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl text-center">
              <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Questions</div>
              <div className="text-xl font-bold">{profile?.questionsAskedToday} / {FREE_LIMITS.QUESTIONS}</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl text-center">
              <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Written</div>
              <div className="text-xl font-bold">{profile?.questionsWrittenToday} / {FREE_LIMITS.WRITTEN}</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl text-center">
              <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Photos</div>
              <div className="text-xl font-bold">{profile?.photosUploadedToday} / {FREE_LIMITS.PHOTOS}</div>
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="space-y-4">
          <div className="relative group">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything or upload a photo of your homework..."
              className="w-full min-h-[160px] bg-zinc-900 border border-zinc-800 rounded-3xl p-6 text-lg focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all resize-none"
            />
            
            <div className="absolute bottom-4 right-4 flex items-center gap-2">
              <div {...getRootProps()} className="cursor-pointer">
                <input {...getInputProps()} />
                <button className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl transition-colors text-zinc-400 hover:text-white">
                  <Camera className="w-6 h-6" />
                </button>
              </div>
              <button
                onClick={handleAsk}
                disabled={isAsking || (!input && !image)}
                className="p-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 rounded-2xl transition-colors text-black"
              >
                {isAsking ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {image && (
            <div className="relative inline-block">
              <img src={image} className="h-32 rounded-2xl border border-zinc-800" alt="Preview" referrerPolicy="no-referrer" />
              <button 
                onClick={() => setImage(null)}
                className="absolute -top-2 -right-2 p-1 bg-red-500 rounded-full text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm">{error}</p>
            </motion.div>
          )}
        </div>

        {/* Recent Answer */}
        <AnimatePresence mode="wait">
          {questions.length > 0 && (
            <motion.div
              key={questions[0].id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-emerald-500 rounded-2xl flex items-center justify-center shrink-0">
                  <BookOpen className="w-6 h-6 text-black" />
                </div>
                <div className="space-y-4 flex-1">
                  <div className="prose prose-invert max-w-none">
                    <ReactMarkdown>{questions[0].answer}</ReactMarkdown>
                  </div>
                  <div className="text-xs text-zinc-500">
                    Answered {format(questions[0].timestamp?.toDate() || new Date(), 'PPp')}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* History Modal */}
      <AnimatePresence>
        {showHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <History className="w-5 h-5 text-emerald-500" />
                  Question History
                </h2>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-zinc-800 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {questions.length === 0 ? (
                  <div className="text-center py-12 text-zinc-500">No questions asked yet.</div>
                ) : (
                  questions.map((q) => (
                    <div key={q.id} className="space-y-3 border-b border-zinc-800 pb-6 last:border-0">
                      <div className="font-medium text-zinc-300">{q.question}</div>
                      <div className="text-sm text-zinc-400 line-clamp-3">
                        <ReactMarkdown>{q.answer}</ReactMarkdown>
                      </div>
                      <div className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">
                        {format(q.timestamp?.toDate() || new Date(), 'PPp')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Premium Modal */}
      <AnimatePresence>
        {showPremium && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPremium(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden"
            >
              <div className="p-8 text-center space-y-6">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto border border-emerald-500/20">
                  <Crown className="w-8 h-8 text-emerald-500" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold">Upgrade to Premium</h2>
                  <p className="text-zinc-400">Get unlimited questions, photo uploads, and priority AI responses.</p>
                </div>
                
                <div className="space-y-4 text-left">
                  <div className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span>Unlimited questions & answers</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span>Unlimited photo uploads</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span>Advanced AI reasoning</span>
                  </div>
                </div>

                <div className="pt-4 space-y-4">
                  <div className="bg-black/50 border border-zinc-800 rounded-2xl p-4 space-y-4">
                    <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
                      <CreditCard className="w-5 h-5 text-zinc-500" />
                      <input 
                        type="text" 
                        placeholder="Card Number" 
                        className="bg-transparent outline-none w-full text-sm"
                      />
                    </div>
                    <div className="flex gap-4">
                      <input 
                        type="text" 
                        placeholder="MM/YY" 
                        className="bg-transparent outline-none w-full text-sm"
                      />
                      <input 
                        type="text" 
                        placeholder="CVC" 
                        className="bg-transparent outline-none w-full text-sm"
                      />
                    </div>
                  </div>
                  
                  <button 
                    onClick={handleUpgrade}
                    className="w-full py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 transition-colors"
                  >
                    Unlock Everything — $9.99/mo
                  </button>
                  <button 
                    onClick={() => setShowPremium(false)}
                    className="text-sm text-zinc-500 hover:text-zinc-400"
                  >
                    Maybe later
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Modal */}
      <AnimatePresence>
        {showSuccess && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSuccess(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden p-8 text-center space-y-6"
            >
              <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto border border-emerald-500/20">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold">Welcome to Premium!</h2>
                <p className="text-zinc-400">Your account has been successfully upgraded. You now have unlimited access to all features.</p>
              </div>
              <button 
                onClick={() => setShowSuccess(false)}
                className="w-full py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 transition-colors"
              >
                Let's Go!
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Dashboard Modal */}
      <AnimatePresence>
        {showAdmin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdmin(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-xl">
                    <ShieldCheck className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Admin Dashboard</h2>
                    <p className="text-xs text-zinc-500">Monitoring all tutor activity</p>
                  </div>
                </div>
                <button onClick={() => setShowAdmin(false)} className="p-2 hover:bg-zinc-800 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid gap-4">
                  {allQuestions.map((q) => (
                    <div key={q.id} className="p-4 bg-zinc-800/30 border border-zinc-800 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-zinc-500">{q.uid}</span>
                        <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-wider">
                          {format(q.timestamp?.toDate() || new Date(), 'PPp')}
                        </span>
                      </div>
                      <div className="font-medium text-zinc-200">{q.question}</div>
                      <div className="text-sm text-zinc-400 bg-black/20 p-3 rounded-xl">
                        <ReactMarkdown>{q.answer}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Ali Alright Animation */}
      <div className="fixed bottom-0 left-0 w-full h-24 overflow-hidden pointer-events-none opacity-10">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.6, 0.3]
          }}
          transition={{ duration: 5, repeat: Infinity }}
          className="absolute bottom-[-50px] left-1/2 -translate-x-1/2 w-[800px] h-[200px] bg-emerald-500 blur-[120px] rounded-full"
        />
      </div>

      <footer className="py-6 text-center text-zinc-600 text-xs border-t border-zinc-900 mt-auto">
        <p>AI Tutor Pro &bull; Made by Ali</p>
        <p className="mt-1 text-[10px] opacity-50">Animations & UI Design by Ali</p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
