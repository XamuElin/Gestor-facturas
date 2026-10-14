import React, { useState, useRef, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  LogOut,
  ChevronDown,
  UserPlus,
  RefreshCw,
  ShieldCheck,
  HardHat,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { SvhLogo } from './SvhLogo';

interface NavbarProps {
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
  onSwitchAccount?: () => void;
  onAddAccount?: () => void;
  isLoggingIn: boolean;
  activeProjectName?: string;
  driveConnected: boolean;
  onOpenObraSelector?: () => void;
  onOpenGuide?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onLogin,
  onLogout,
  onSwitchAccount,
  onAddAccount,
  isLoggingIn,
  activeProjectName,
  driveConnected,
  onOpenObraSelector,
  onOpenGuide,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="bg-white text-slate-900 border-b border-slate-200/90 sticky top-0 z-30 shadow-2xs">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
        {/* Brand & Identity with SVH Logo */}
        <div className="flex items-center gap-2.5 sm:gap-4 min-w-0 mr-2">
          <div className="flex items-center py-1 shrink-0">
            {/* Logo completo con subtítulo en tablet/PC, logo compacto en móvil */}
            <div className="hidden sm:block">
              <SvhLogo size="md" showSubtitle={true} />
            </div>
            <div className="sm:hidden">
              <SvhLogo size="sm" showSubtitle={false} />
            </div>
          </div>

          <div className="h-8 w-px bg-slate-200 mx-0.5 hidden sm:block shrink-0" />

          {/* Chip de Obra Activa (Requisito Header Móvil y Desktop) */}
          {user && onOpenObraSelector && (
            <button
              type="button"
              id="btn-navbar-obra-chip"
              onClick={onOpenObraSelector}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0F766E]/10 hover:bg-[#0F766E]/20 text-[#0F766E] border border-[#0F766E]/20 text-xs font-bold transition-all shrink-0 max-w-[150px] sm:max-w-[220px] cursor-pointer shadow-2xs touch-target-48 sm:min-h-0"
              title="Toca para cambiar de obra o carpeta de Drive"
            >
              <span className="truncate">{activeProjectName || 'Seleccionar Obra'}</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[#0F766E]" />
            </button>
          )}

          <div className="min-w-0 hidden md:block">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-bold text-sm sm:text-lg tracking-tight text-slate-900 font-sans truncate">
                Facturas
              </span>
              <span className="text-[10px] sm:text-[11px] bg-[#16A34A]/10 text-[#16A34A] font-semibold px-2 sm:px-2.5 py-0.5 rounded-full border border-[#16A34A]/25 flex items-center gap-1 sm:gap-1.5 shadow-2xs shrink-0 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></span>
                <span>Drive &amp; Sheets</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden lg:block truncate">
              Control y archivo automático de facturas por proyecto de obra
            </p>
          </div>
        </div>

        {/* Right Action & User Profile with Account Management Dropdown + Botón "?" */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Botón "?" de Guía Rápida */}
          {onOpenGuide && (
            <button
              type="button"
              id="btn-navbar-help-guide"
              onClick={onOpenGuide}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-[14px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center transition-colors shadow-2xs cursor-pointer touch-target-48"
              title="Abrir Guía del Sistema"
            >
              ?
            </button>
          )}
          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                id="btn-user-account-menu"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className="flex items-center gap-2.5 p-1 sm:px-2.5 sm:py-1.5 rounded-xl hover:bg-slate-100/90 border border-slate-200/90 transition-all cursor-pointer group shadow-2xs"
                title="Opciones de cuenta y sesión"
              >
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Usuario'}
                    className="w-8 h-8 rounded-full border border-slate-200 object-cover shadow-2xs shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#1ca330] text-white flex items-center justify-center text-xs font-bold shadow-2xs shrink-0">
                    {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
                  </div>
                )}

                <div className="hidden sm:block text-left mr-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-slate-900 leading-tight truncate max-w-[130px]">
                      {user.displayName || user.email?.split('@')[0]}
                    </p>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Sesión activa permanente" />
                  </div>
                  <p className="text-[10px] text-slate-500 truncate max-w-[130px]">
                    {user.email}
                  </p>
                </div>

                <ChevronDown className={`w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-transform duration-150 ${isMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Account Dropdown Menu */}
              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white rounded-2xl shadow-xl border border-slate-200/90 p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                  {/* User Profile Header */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-1.5 space-y-1">
                    <div className="flex items-center gap-2.5">
                      {user.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName || ''}
                          className="w-10 h-10 rounded-full border border-slate-200 object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[#1ca330] text-white flex items-center justify-center font-bold text-sm">
                          {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {user.displayName || 'Usuario Google'}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {user.email}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50/80 px-2 py-0.5 rounded-md border border-emerald-200/80 mt-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Sesión persistente activa (no se cerrará sola)</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-1">
                    {/* Switch Account */}
                    <button
                      type="button"
                      id="btn-switch-account"
                      onClick={() => {
                        setIsMenuOpen(false);
                        if (onSwitchAccount) {
                          onSwitchAccount();
                        } else {
                          onLogin();
                        }
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 rounded-xl transition-colors cursor-pointer text-left"
                    >
                      <RefreshCw className="w-4 h-4 text-sky-600 shrink-0" />
                      <div>
                        <span>Cambiar cuenta</span>
                        <p className="text-[10px] text-slate-400 font-normal">
                          Elige otra cuenta de Google Workspace o Gmail
                        </p>
                      </div>
                    </button>

                    {/* Add Account */}
                    <button
                      type="button"
                      id="btn-add-account"
                      onClick={() => {
                        setIsMenuOpen(false);
                        if (onAddAccount) {
                          onAddAccount();
                        } else if (onSwitchAccount) {
                          onSwitchAccount();
                        } else {
                          onLogin();
                        }
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 rounded-xl transition-colors cursor-pointer text-left"
                    >
                      <UserPlus className="w-4 h-4 text-indigo-600 shrink-0" />
                      <div>
                        <span>Agregar cuenta</span>
                        <p className="text-[10px] text-slate-400 font-normal">
                          Conectar otra cuenta de Google
                        </p>
                      </div>
                    </button>

                    <div className="h-px bg-slate-100 my-1" />

                    {/* Logout */}
                    <button
                      type="button"
                      id="btn-logout"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50/80 rounded-xl transition-colors cursor-pointer text-left"
                    >
                      <LogOut className="w-4 h-4 text-rose-600 shrink-0" />
                      <div>
                        <span>Cerrar sesión</span>
                        <p className="text-[10px] text-rose-400 font-normal">
                          Solo se cerrará cuando tú lo decidas
                        </p>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              id="btn-google-login-header"
              onClick={onLogin}
              disabled={isLoggingIn}
              className="inline-flex items-center gap-2.5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-medium text-xs sm:text-sm transition-all shadow-sm active:scale-95 disabled:opacity-60 cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 48 48">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                ></path>
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                ></path>
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                ></path>
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                ></path>
              </svg>
              <span>{isLoggingIn ? 'Conectando...' : 'Acceder con Google'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
