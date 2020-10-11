" Support 256 colors
":set t_Co=256

" :set mouse=n

:syntax on
:set list
:set listchars=
:set ai
:set ic
:set tabstop=80
:set sw=2
:set scrolloff=5
:set title
:set titlestring=%t
:set titleold=...

:set background=light
:set nobackup
:set backupcopy=yes
:let loaded_matchparen = 1

:set incsearch
:set hlsearch

function ToggleHLSearch()
  if &hls
    set nohls
  else
    set hls
  endif
endfunction

nmap <silent> <C-n> <Esc>:call ToggleHLSearch()<CR>

:highlight LineTooLong cterm=bold ctermbg=red guibg=LightYellow
:match LineTooLong /\%>80v.\+/

:highlight ExtraWhitespace ctermbg=red guibg=red
:match ExtraWhitespace /\s\+$/

":highlight Comment cterm=bold gui=bold
:highlight Comment cterm=none gui=none
:highlight Statement gui=none
:highlight ModeMsg gui=none
:highlight MoreMsg gui=none
:highlight Question gui=none
:highlight StatusLine gui=none
:highlight Title gui=none
:highlight Search ctermbg=yellow guibg=yellow


:if &term =~ "xterm"
:  if has("terminfo")
:    set t_Co=8
:    set t_Sf=^[[3%p1%dm
:    set t_Sb=^[[4%p1%dm
:  else
:    set t_Co=8
:    set t_Sf=^[[3%dm
:    set t_Sb=^[[4%dm
:  endif
:endif


" Pathogen plugin manager
" execute pathogen#infect()
"
" " eslint integration
" set statusline+=%#warningmsg#
" set statusline+=%{SyntasticStatuslineFlag()}
" set statusline+=%*
"
" let g:syntastic_always_populate_loc_list = 1
" let g:syntastic_auto_loc_list = 1
" let g:syntastic_check_on_open = 1
" let g:syntastic_check_on_wq = 1
" let g:syntastic_javascript_checkers = ['eslint']
" let b:syntastic_javascript_eslint_exec = 'eslint'
