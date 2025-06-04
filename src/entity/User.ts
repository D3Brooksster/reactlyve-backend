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
  max_messages_per_month?: number;
  max_reactions_per_month?: number;
  current_messages_this_month?: number;
  reactions_received_this_month?: number; // Added
  last_usage_reset_date?: Date;
  max_reactions_per_message?: number;
  // New fields for reaction author limits
  max_reactions_authored_per_month?: number;
  reactions_authored_this_month?: number;
}