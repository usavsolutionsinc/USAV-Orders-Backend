export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface FormState {
  name: string;
  letter: string;
  description: string;
}

export const EMPTY_FORM: FormState = { name: '', letter: '', description: '' };
