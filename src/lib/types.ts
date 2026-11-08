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
  membership_number: string | null;
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
  membership_number: string | null;
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

export interface PersonEnrolment {
  term_id: string;
  class_id: string;
  skate_class: { id: string; name: string; term: { id: string; name: string; starts_on: string } };
}

export interface PersonDetail extends Person {
  enrolment: PersonEnrolment[];
  contact: Contact[];
  person_ethnicity: { ethnicity_code: string }[];
  person_other_club: { id: string; club_name: string }[];
  membership_member: PersonMembershipLink[];
}

export interface MemberSummary {
  id: string;
  membership_number: string | null;
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

// Kiwiskate (stage 3a)

export interface BadgeStream {
  id: number;
  code: string;
  name: string;
  rule_section: string | null;
  note: string | null;
  sort_order: number;
}

export interface Badge {
  id: number;
  stream_id: number;
  name: string;
  sort_order: number;
  prerequisite_id: number | null;
  max_age: number | null;
  description: string | null;
}

export type BadgeSkillKind = 'assessment' | 'teaching';

export interface BadgeSkill {
  id: number;
  badge_id: number;
  kind: BadgeSkillKind;
  sort_order: number;
  description: string;
}

export interface BadgeCatalog {
  streams: BadgeStream[];
  badges: Badge[];
  skills: BadgeSkill[];
}

export interface SkillAchievement {
  person_id: string;
  skill_id: number;
  achieved_on: string;
  note: string | null;
}

export type AssessorType = 'judge' | 'coach';

export interface BadgePass {
  id: string;
  person_id: string;
  badge_id: number;
  passed_on: string;
  assessor_name: string;
  assessor_type: AssessorType;
  note: string | null;
}

export interface SkaterProgress {
  achievements: SkillAchievement[];
  passes: BadgePass[];
}

// Terms, classes and enrolments (stage 3b)

export interface Term {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
}

export interface SkateClassFields {
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  min_age: number | null;
  max_age: number | null;
  coach_name: string | null;
}

export interface SkateClass extends SkateClassFields {
  id: string;
  term_id: string;
  badge_ids: number[];
  enrolled: number;
}

export interface ClassSkater {
  id: string;
  first_name: string;
  last_name: string;
  membership_number: string | null;
  date_of_birth: string | null;
}

export interface ClassDetail extends SkateClass {
  term: Term;
  skaters: ClassSkater[];
}
