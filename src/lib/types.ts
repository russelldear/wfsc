// Row shapes returned by Supabase. Kept by hand to match
// supabase/migrations; update both together.

export type MembershipKind = 'individual' | 'family';

export interface Gender {
  code: string;
  label: string;
  sort_order: number;
}

export interface Ethnicity {
  code: string;
  label: string;
  sort_order: number;
}

export interface MemberType {
  id: number;
  name: string;
  active: boolean;
}

export interface Lookups {
  genders: Gender[];
  ethnicities: Ethnicity[];
  memberTypes: MemberType[];
}

export interface PersonFields {
  membership_number: number | null;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender_code: string | null;
  address_line: string | null;
  town_city: string | null;
  postcode: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  in_skate_school: boolean;
  member_since: string | null;
  coc_agreed_on: string | null;
  waiver_agreed_on: string | null;
  nzifsa_share_agreed_on: string | null;
}

export interface Person extends PersonFields {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id?: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  is_guardian: boolean;
}

export interface PersonRef {
  id: string;
  first_name: string;
  last_name: string;
  membership_number: number | null;
}

export interface MembershipMemberRow {
  person_id: string;
  member_type_id: number | null;
  card_issued_on: string | null;
  person: PersonRef;
}

export interface Membership {
  id: string;
  kind: MembershipKind;
  season_start: string;
  expires_on: string;
  paid_on: string | null;
  membership_member: MembershipMemberRow[];
}

export interface PersonMembershipLink {
  member_type_id: number | null;
  card_issued_on: string | null;
  membership: Membership;
}

export interface PersonDetail extends Person {
  contact: Contact[];
  person_ethnicity: { ethnicity_code: string }[];
  person_other_club: { id: string; club_name: string }[];
  membership_member: PersonMembershipLink[];
}

export interface MemberSummary {
  id: string;
  membership_number: number | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  in_skate_school: boolean;
  membership_id: string | null;
  kind: MembershipKind | null;
  season_start: string | null;
  expires_on: string | null;
  member_type: string | null;
  is_current: boolean;
}
