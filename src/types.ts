export interface UserProfile {
  uid: string;
  email: string;
  isPremium: boolean;
  questionsAskedToday: number;
  questionsWrittenToday: number;
  photosUploadedToday: number;
  lastResetDate: string;
}

export interface QuestionHistory {
  id?: string;
  uid: string;
  question: string;
  answer: string;
  imageUrl?: string;
  timestamp: any;
}

export const FREE_LIMITS = {
  QUESTIONS: 15,
  WRITTEN: 15,
  PHOTOS: 5
};
