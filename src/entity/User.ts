export interface User {
  id: string;            // UUID string
  google_id?: string;
  email: string;
  name: string;
  picture?: string;
  role: 'user' | 'admin';
  blocked: boolean;
  created_at: Date;
  updated_at: Date;
}