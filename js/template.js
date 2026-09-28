/*
 * Variable definitions, automatic column mapping and {{variable}} rendering.
 */
(function (ROG) {
  'use strict';

  // `exact`: header names that map on a full (normalised) match, in order of preference.
  // `contains`: fragments used as a second pass when no exact match exists.
  var PROSPECT_VARS = [
    {
      name: 'business_name', label: 'Business Name',
      exact: ['business name', 'business', 'company name', 'company', 'business title', 'place name', 'store name', 'organization', 'organisation', 'name', 'title'],
      contains: ['businessname', 'companyname', 'business', 'company', 'placename', 'storename', 'organization', 'organisation']
    },
    {
      name: 'owner_name', label: 'Owner Name',
      exact: ['owner name', 'owner', 'contact name', 'contact', 'contact person', 'full name', 'first name', 'person', 'name'],
      contains: ['ownername', 'owner', 'contactname', 'contactperson', 'fullname', 'firstname']
    },
    {
      name: 'email', label: 'Email',
      exact: ['email', 'e-mail', 'email address', 'e-mail address', 'mail', 'contact email', 'business email'],
      contains: ['email']
    },
    {
      name: 'phone', label: 'Phone',
      exact: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'cell', 'business phone', 'contact phone'],
      contains: ['phone', 'telephone', 'mobile']
    },
    {
      name: 'address', label: 'Address',
      exact: ['address', 'street address', 'street', 'full address', 'address 1', 'address line 1', 'location'],
      contains: ['address', 'street']
    },
    {
      name: 'city', label: 'City',
      exact: ['city', 'town', 'locality'],
      contains: ['city']
    },
    {
      name: 'state', label: 'State',
      exact: ['state', 'province', 'region', 'st', 'state province'],
      contains: ['state', 'province']
    },
    {
      name: 'zip', label: 'ZIP',
      exact: ['zip', 'zip code', 'zipcode', 'postal code', 'postcode', 'postal', 'post code'],
      contains: ['zip', 'postal', 'postcode']
    },
    {
      name: 'website', label: 'Website',
      exact: ['website', 'web site', 'url', 'site', 'web', 'domain', 'homepage', 'website url'],
      contains: ['website', 'homepage', 'domain', 'url']
    },
    {
      name: 'total_reviews', label: 'Total Reviews',
      exact: ['total reviews', 'reviews', 'review count', 'reviews count', 'number of reviews', 'num reviews', '# reviews', 'reviews total', 'user ratings total'],
      contains: ['totalreviews', 'reviewcount', 'reviewscount', 'numberofreviews', 'reviews']
    },
    {
      name: 'last_review', label: 'Last Review',
      exact: ['last review', 'last review date', 'latest review', 'most recent review', 'last reviewed', 'last review time', 'newest review'],
      contains: ['lastreview', 'latestreview', 'mostrecentreview', 'newestreview']
    },
    {
      name: 'reviews_last_month', label: 'Reviews Last Month',
      exact: ['reviews last month', 'reviews this month', 'reviews last 30 days', 'reviews past 30 days', 'monthly reviews', 'recent reviews', 'new reviews'],
      contains: ['reviewslastmonth', 'reviewsthismonth', 'last30days', 'past30days', 'monthlyreviews', 'recentreviews', 'newreviews']
    },
    {
      name: 'review_link', label: 'Review Link',
      exact: ['review link', 'review url', 'reviews link', 'reviews url', 'google review link', 'write review link', 'maps url', 'google maps url', 'maps link', 'place url'],
      contains: ['reviewlink', 'reviewurl', 'reviewslink', 'reviewsurl', 'writereview', 'mapsurl', 'mapslink', 'placeurl']
    }
  ];

  // Second-pass order: most specific fragments first so "Reviews Last Month"
  // is not swallowed by the generic "reviews" fragment of total_reviews.
  var CONTAINS_ORDER = [
    'reviews_last_month', 'last_review', 'review_link', 'total_reviews', 'owner_name',
    'business_name', 'email', 'phone', 'website', 'address', 'city', 'state', 'zip'
  ];

  var SENDER_VARS = [
    { name: 'my_name', label: 'My Name', key: 'name' },
    { name: 'my_company', label: 'My Company', key: 'company' },
    { name: 'my_phone', label: 'My Phone', key: 'phone' },
    { name: 'my_email', label: 'My Email', key: 'email' },
    { name: 'my_website', label: 'My Website', key: 'website' }
  ];

  var PROSPECT_BY_NAME = {};
  PROSPECT_VARS.forEach(function (v) { PROSPECT_BY_NAME[v.name] = v; });
  var SENDER_BY_NAME = {};
  SENDER_VARS.forEach(function (v) { SENDER_BY_NAME[v.name] = v; });

  function normalize(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9#]/g, '');
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /** Map standard variables to column indexes. Unmatched variables get -1. */
  function autoMap(headers) {
    var norm = headers.map(normalize);
    var used = {};
    var mapping = {};
    PROSPECT_VARS.forEach(function (v) { mapping[v.name] = -1; });

    // Pass 1: exact matches (the variable name itself counts as an exact match).
    PROSPECT_VARS.forEach(function (v) {
      var candidates = [v.name].concat(v.exact).map(normalize);
      for (var c = 0; c < candidates.length; c++) {
        for (var i = 0; i < norm.length; i++) {
          if (!used[i] && norm[i] === candidates[c]) {
            mapping[v.name] = i;
            used[i] = true;
            return;
          }
        }
      }
    });

    // Pass 2: header contains a known fragment.
    CONTAINS_ORDER.forEach(function (name) {
      if (mapping[name] !== -1) return;
      var fragments = PROSPECT_BY_NAME[name].contains;
      for (var f = 0; f < fragments.length; f++) {
        for (var i = 0; i < norm.length; i++) {
          if (!used[i] && norm[i].indexOf(fragments[f]) !== -1) {
            mapping[name] = i;
            used[i] = true;
            return;
          }
        }
      }
    });

    return mapping;
  }

  /**
   * Variables for CSV columns that are not mapped to a standard variable,
   * e.g. a "Category" column becomes {{category}}.
   */
  function customVariables(headers, mapping) {
    var mappedCols = {};
    Object.keys(mapping).forEach(function (k) {
      if (mapping[k] >= 0) mappedCols[mapping[k]] = true;
    });
    var taken = {};
    PROSPECT_VARS.forEach(function (v) { taken[v.name] = true; });
    SENDER_VARS.forEach(function (v) { taken[v.name] = true; });

    var result = [];
    headers.forEach(function (header, col) {
      if (mappedCols[col]) return;
      var slug = slugify(header);
      if (!slug || taken[slug]) return;
      if (/^[0-9]/.test(slug)) slug = 'col_' + slug;
      if (taken[slug]) return;
      taken[slug] = true;
      result.push({ name: slug, label: header, col: col });
    });
    return result;
  }

  var VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

  /**
   * Render a template.
   * resolve(name) -> { known: boolean, value: string, reason?: string }
   * Returns { text, segments } where segments is a list of
   *   { type: 'text', value } | { type: 'var', name, raw, known, value, reason }
   */
  function render(template, resolve, fallback) {
    var segments = [];
    var text = '';
    var last = 0;
    var match;
    fallback = fallback || '';
    template = template || '';
    VAR_RE.lastIndex = 0;

    while ((match = VAR_RE.exec(template)) !== null) {
      if (match.index > last) {
        var plain = template.slice(last, match.index);
        segments.push({ type: 'text', value: plain });
        text += plain;
      }
      var name = match[1].toLowerCase();
      var res = resolve(name) || { known: false };
      var seg = {
        type: 'var',
        name: name,
        raw: match[0],
        known: !!res.known,
        value: res.known ? res.value || '' : '',
        reason: res.reason || null
      };
      segments.push(seg);
      if (!seg.known) text += seg.raw;
      else text += seg.value !== '' ? seg.value : fallback;
      last = match.index + match[0].length;
    }
    if (last < template.length) {
      var rest = template.slice(last);
      segments.push({ type: 'text', value: rest });
      text += rest;
    }
    return { text: text, segments: segments };
  }

  /** Values that should never leak into an email. */
  function cleanValue(v) {
    if (v == null) return '';
    var s = String(v).trim();
    var lower = s.toLowerCase();
    if (lower === 'null' || lower === 'undefined' || lower === 'nan') return '';
    return s;
  }

  var DEFAULT_TEMPLATE = {
    id: 'default',
    name: 'Review Outreach',
    subject: 'Quick Review Audit for {{business_name}}',
    body: [
      'Hello {{business_name}} Team,',
      '',
      'We recently visited your business and collected your details',
      'from your business card.',
      '',
      'We also reviewed your online profile and noticed that you',
      'currently have {{total_reviews}} reviews, with your most recent',
      'review posted {{last_review}} ago.',
      '',
      'Your business serves real customers every day, but many businesses',
      'miss opportunities to turn those customer experiences into reviews.',
      '',
      'We’ve developed simple software that helps small businesses',
      'consistently request and collect customer reviews.',
      '',
      'More recent, genuine reviews can help improve your Google visibility,',
      'build trust with potential customers, and create more opportunities',
      'to attract new customers.',
      '',
      'We’ve attached a short video showing how it works.',
      '',
      'For more information, contact us at {{my_phone}}.',
      '',
      'Best regards,',
      '',
      '{{my_name}}',
      '{{my_company}}',
      '{{my_phone}}'
    ].join('\n')
  };

  // Example rows for the downloadable CSV template, in PROSPECT_VARS order.
  // "Last Review" omits "ago" because the default template adds it.
  var TEMPLATE_EXAMPLES = [
    ['ABC Roofing', 'John Carter', 'john@abcroofing.example', '555-201-3344', '12 Oak St', 'Springfield', 'IL', '62701',
      'https://abcroofing.example', '87', '3 weeks', '2', 'https://g.page/r/abc-roofing/review'],
    ['XYZ Plumbing', '', 'info@xyzplumbing.example', '555-310-8890', '440 Main St', 'Springfield', 'IL', '62702',
      'https://xyzplumbing.example', '42', '1 month', '0', '']
  ];

  /** Header row (one column per standard variable) plus example rows. */
  function csvTemplateRows() {
    return [PROSPECT_VARS.map(function (v) { return v.label; })].concat(TEMPLATE_EXAMPLES);
  }

  ROG.template = {
    PROSPECT_VARS: PROSPECT_VARS,
    SENDER_VARS: SENDER_VARS,
    PROSPECT_BY_NAME: PROSPECT_BY_NAME,
    SENDER_BY_NAME: SENDER_BY_NAME,
    DEFAULT_TEMPLATE: DEFAULT_TEMPLATE,
    autoMap: autoMap,
    customVariables: customVariables,
    render: render,
    cleanValue: cleanValue,
    slugify: slugify,
    csvTemplateRows: csvTemplateRows
  };
})((window.ROG = window.ROG || {}));
