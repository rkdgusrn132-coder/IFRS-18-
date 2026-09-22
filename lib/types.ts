export type Company = {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  corp_eng_name: string;
};

export type StatementRow = {
  display_order: number;
  source_index: number;
  presentation_order: number;

  dart_order: string | null;

  source_statement: string;
  statement_scope: string;

  account_id: string | null;

  account: string;
  display_account: string;

  account_detail: string | null;

  current_amount: number | null;
  prior_amount: number | null;
  before_prior_amount: number | null;

  currency: string;

  value_type: "monetary" | "per_share";

  display_unit: string;

  non_classification_type: string | null;

  ifrs18_status: string;

  review_area: string;
  review_reason: string;

  next_action: string | null;

  category_hint: string | null;

  provisional_category: string | null;
};

export type ExcludedRow = {
  display_order: number;

  exclusion_type: string;

  dart_order: string | null;

  account_id: string | null;

  account: string;

  current_amount: number | null;
  prior_amount: number | null;

  currency: string;

  value_type: string;
  display_unit: string;

  statement_scope: string;

  ifrs18_status: string;

  exclusion_reason: string;
};

export type StatementResponse = {
  report: { report_name: string; rcept_no: string; rcept_date: string };
  rcept_no: string;
  analyzed_at: string;
  company: string;
  corp_code: string;

  year: string;

  statement_type: string;
  fs_div: string;

  source_statement: string;

  source_statement_name: string;

  source_amount_unit: string;

  normal_display_unit: string;

  per_share_display_unit: string;

  category_options: string[];

  ordering_method: string;

  counts: {
    source_rows: number;

    profit_or_loss_rows: number;

    review_candidates: number;

    summary_rows: number;

    category_hints: number;

    excluded_oci_rows: number;

    excluded_comprehensive_rows: number;

    total_excluded_rows: number;
  };

  statement_rows: StatementRow[];

  excluded_oci_rows: ExcludedRow[];

  excluded_comprehensive_rows: ExcludedRow[];

  error?: string;
};

export type FinanceDetailRow = {
  category: string;
  account: string;

  current_amount: number | null;
  prior_amount: number | null;

  note_number: string;

  ifrs18_status: string;

  classification_driver: string | null;

  provisional_category: string | null;

  next_action: string | null;
};

export type FinanceAnalysisResponse = {
  company: string;
  corp_code: string;

  year: string;

  statement_type: string;
  fs_div: string;

  report: {
    report_name: string;
    rcept_no: string;
    rcept_date: string;
  };

  finance_note: {
    note_number: string;
    note_title: string;
    unit: string;
  };

  financial_data: FinanceDetailRow[];

  description: string | null;

  reconciliation: unknown;

  error?: string;
};

export type EvidenceCell = {
  text: string;

  row_span: number;
  col_span: number;

  header: boolean;
};

/*
  범용 손익계정 근거 표
*/
export type StatementEvidenceTable = {
  reconciliation: import("./evidence").Reconciliation | null;
  matched_amount: number | null;
  table_index: number;

  unit: string | null;

  score: number;

  direct_account_score: number;

  amount_match_score: number;

  contextual_score: number;

  direct_account_match: boolean;

  amount_match: boolean;

  matched_account_terms: string[];

  matched_keywords: string[];

  focused_rows: EvidenceCell[][];

  rows: EvidenceCell[][];
};

export type StatementEvidenceParagraph = {
  text: string;

  score: number;

  matched_account_terms: string[];

  matched_keywords: string[];
};

export type StatementEvidenceCandidate = {
  note_number: string;

  note_title: string;

  score: number;

  evidence_type: string;

  title_score: number;

  matched_title_keywords: string[];

  matched_title_account_terms: string[];

  paragraphs: StatementEvidenceParagraph[];

  tables: StatementEvidenceTable[];
};

export type StatementEvidenceResponse = {
  primary_confidence: "verified" | "reconciled" | "strong" | "review" | null;
  company: string | null;

  corp_code: string;

  year: string;

  statement_type: string;

  account: string;

  current_amount: number | null;

  review_reason: string;

  search_profile: {
    aliases: string[];
    title_keywords: string[];
    body_keywords: string[];
  };

  report: {
    report_name: string;
    rcept_no: string;
    rcept_date: string;
  };

  candidate_count: number;

  primary_evidence: StatementEvidenceCandidate | null;

  evidence: StatementEvidenceCandidate[];

  error?: string;
};

/*
  기존 금융 세부계정 근거
*/
export type FinanceEvidenceTable = {
  table_index: number;

  unit: string | null;

  direct_account_score: number;

  contextual_score: number;

  classification_score: number;

  amount_match: boolean;

  direct_account_match: boolean;

  classification_structure: boolean;

  matched_account_terms: string[];

  matched_keywords: string[];

  rows: EvidenceCell[][];

  focused_rows: EvidenceCell[][];
};

export type FinanceTableEvidence = {
  note_number: string;

  note_title: string;

  table: FinanceEvidenceTable;
};

export type ContextualEvidence = {
  note_number: string;

  note_title: string;

  text: string;

  score: number;

  matched_keywords: string[];
};

export type FinanceEvidenceResponse = {
  primary_confidence: "verified" | "strong" | "review" | null;
  report: { report_name: string; rcept_no: string; rcept_date: string };
  year: string;

  statement_type: string;

  category: string | null;

  account: string;

  current_amount: number | null;

  review_reason: string;

  amount_evidence: FinanceTableEvidence | null;

  classification_evidence: FinanceTableEvidence | null;

  contextual_evidence: ContextualEvidence | null;

  error?: string;
};

export type ReviewCategory =
  | "영업"
  | "투자"
  | "재무"
  | "법인세"
  | "중단영업"
  | "추가검토";

export type ReviewDecision = {
  review_status?: "미검토" | "검토중" | "완료";
  classification: ReviewCategory | null;

  memo: string;
};

export type ReviewDecisionMap = Record<
  string,
  ReviewDecision
>;

export type StatementEvidenceCache = Record<
  string,
  StatementEvidenceResponse
>;

