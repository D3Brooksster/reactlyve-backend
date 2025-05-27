export interface AppUser { // Renamed from User to AppUser
  id: string;            // UUID string
  google_id?: string;
  email: string;
  name: string;
  picture?: string;
  last_login?: Date;
  role: 'user' | 'admin' | 'guest';
  blocked: boolean;
  created_at: Date;
  updated_at: Date;
}