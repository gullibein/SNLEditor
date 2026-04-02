// InstantDB has been removed from this project.
// This file is kept as a stub to avoid import errors during the transition.
// It can be safely deleted once all references have been cleaned up.

export const db = null;
export const id = () => Math.random().toString(36).slice(2);
export const hashPassword = async (password: string): Promise<string> => password;
export const PROTECTED_FOLDER_PASSWORD_HASH = '';

export type Schema = any;
export type Folder = any;
export type Spritesheet = any;
export type World = any;
