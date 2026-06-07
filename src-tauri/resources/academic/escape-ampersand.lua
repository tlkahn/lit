if FORMAT:match 'latex' then
  local PLACEHOLDER = '\0AMP\0'

  local function escape_bare_amp(s)
    s = s:gsub('\\&', PLACEHOLDER)
    s = s:gsub('&', '\\&')
    s = s:gsub(PLACEHOLDER, '\\&')
    return s
  end

  local ALIGN_ENVS = {
    'align', 'aligned', 'alignat', 'alignedat',
    'eqnarray', 'gather', 'gathered',
    'multline', 'split', 'cases', 'dcases',
    'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix',
    'array', 'tabular', 'longtable', 'smallmatrix',
  }

  local function has_align_env(s)
    for _, env in ipairs(ALIGN_ENVS) do
      if s:find('\\begin{' .. env .. '}', 1, true) or s:find('\\begin{' .. env .. '*}', 1, true) then
        return true
      end
    end
    return false
  end

  function RawInline(el)
    if el.format == 'tex' or el.format == 'latex' then
      if not has_align_env(el.text) then
        el.text = escape_bare_amp(el.text)
        return el
      end
    end
  end

  function RawBlock(el)
    if el.format == 'tex' or el.format == 'latex' then
      if not has_align_env(el.text) then
        el.text = escape_bare_amp(el.text)
        return el
      end
    end
  end

  function Math(el)
    if not has_align_env(el.text) then
      el.text = escape_bare_amp(el.text)
      return el
    end
  end
end
