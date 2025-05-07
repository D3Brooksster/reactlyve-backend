export interface User {
    id: number;
    googleId: string;
    email: string;
    name:string;
    picture?: string;
    role?:string;
    blocked?:boolean;
    createdAt: Date;
    updatedAt: Date;
  }