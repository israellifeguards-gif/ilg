export type UserRole = 'SeaLifeguard' | 'PoolLifeguard' | 'AssistantLifeguard' | 'PoolOperator' | 'Employer' | 'Courses' | 'Admin';

export interface ILGUser {
  uid: string;
  displayName: string;
  phone: string;
  role: UserRole;
  certification_url: string | null;
  is_verified: boolean;
  sos_active: boolean;
  radius_pref: number; // km, 0 = nationwide
  consent_timestamp: string | null;
  ip_address: string | null;
  created_at: string;
}

export type JobType = 'Regular' | 'SOS';

export type RequiredRole = 'SeaLifeguard' | 'PoolLifeguard' | 'AssistantLifeguard' | 'PoolOperator';

export interface Job {
  id: string;
  job_type: JobType;
  title: string;
  description: string;
  required_role?: RequiredRole;
  location: {
    lat: number;
    lng: number;
    label: string; // e.g. "תל אביב"
  };
  contact: {
    phone: string;
    whatsapp?: string;
  };
  employer_uid: string;
  created_at: string;
  expires_at?: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  course_type: 'Course' | 'Training';
  location: string;
  date: string;
  price?: string;
  contact: {
    phone: string;
    whatsapp?: string;
  };
  publisher_uid: string;
  created_at: string;
}

export interface GlobalAlert {
  message: string;
  active: boolean;
  updated_at: string;
}

export interface WeatherData {
  sea_height: number;    // meters
  wind_direction: string; // e.g. "NW"
  wind_speed: number;    // km/h
  water_temp: number;    // °C
  uv_index: number;
}

export interface AdminUpdate {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}
