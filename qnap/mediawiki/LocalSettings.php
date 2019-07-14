<?php
# This file was automatically generated by the MediaWiki 1.27.5
# installer. If you make manual changes, please keep track in case you
# need to recreate them later.
#
# See includes/DefaultSettings.php for all configurable settings
# and their default values, but don't forget to make changes in _this_
# file, not there.
#
# Further documentation for configuration settings may be found at:
# https://www.mediawiki.org/wiki/Manual:Configuration_settings

# Protect against web entry
if ( !defined( 'MEDIAWIKI' ) ) {
	exit;
}

## Uncomment this to disable output compression
# $wgDisableOutputCompression = true;

$wgSitename = "heine7Wiki";
$wgMetaNamespace = "MeinWiki";

## The URL base path to the directory containing the wiki;
## defaults for all runtime URL paths are based off of this.
## For more information on customizing the URLs
## (like /w/index.php/Page_title to /wiki/Page_title) please see:
## https://www.mediawiki.org/wiki/Manual:Short_URL
$wgScriptPath = "/wiki";

## The protocol and server name to use in fully-qualified URLs
$wgServer = "https://heine7.de";

## The URL path to static resources (images, scripts, etc.)
$wgResourceBasePath = $wgScriptPath;

## The URL path to the logo.  Make sure you change this from the default,
## or else you'll overwrite your logo when you upgrade!
$wgLogo = "/favicon.png";
$wgFavicon = "/favicon.png";

## UPO means: this is also a user preference option

$wgEnableEmail = true;
$wgEnableUserEmail = true; # UPO

$wgEmergencyContact = "technik@heine7.de";
$wgPasswordSender = "technik@heine7.de";

$wgEnotifUserTalk = false; # UPO
$wgEnotifWatchlist = false; # UPO
$wgEmailAuthentication = true;

## Database settings
$wgDBtype = "mysql";
$wgDBserver = "mediawiki-database";
$wgDBname = "my_wiki";
$wgDBuser = "wikiuser";
$wgDBpassword = "example";

# MySQL specific settings
$wgDBprefix = "";

# MySQL table options to use during installation or update
$wgDBTableOptions = "ENGINE=InnoDB, DEFAULT CHARSET=binary";

# Experimental charset support for MySQL 5.0.
$wgDBmysql5 = false;

## Shared memory settings
$wgMainCacheType = CACHE_DB;
$wgMemCachedServers = [];

## To enable image uploads, make sure the 'images' directory
## is writable, then set this to true:
$wgEnableUploads = true;
$wgUseImageMagick = true;
$wgImageMagickConvertCommand = "/usr/bin/convert";

# InstantCommons allows wiki to use images from https://commons.wikimedia.org
$wgUseInstantCommons = false;

## If you use ImageMagick (or any other shell command) on a
## Linux server, this will need to be set to the name of an
## available UTF-8 locale
$wgShellLocale = "C.UTF-8";

## Set $wgCacheDirectory to a writable directory on the web server
## to make your wiki go slightly faster. The directory should not
## be publically accessible from the web.
#$wgCacheDirectory = "$IP/cache";

# Site language code, should be one of the list in ./languages/data/Names.php
$wgLanguageCode = "de";

$wgSecretKey = "0abb1440583438cf2371e7f7f1d4668340749743da9682cd0087f55257fa3ab6";

# Changing this will log out all existing sessions.
$wgAuthenticationTokenVersion = "1";

# Site upgrade key. Must be set to a string (default provided) to turn on the
# web installer while LocalSettings.php is in place
$wgUpgradeKey = "8a05526f4e2349ae";

## For attaching licensing metadata to pages, and displaying an
## appropriate copyright notice / icon. GNU Free Documentation
## License and Creative Commons licenses are supported so far.
$wgRightsPage = ""; # Set to the title of a wiki page that describes your license/copyright
$wgRightsUrl = "";
$wgRightsText = "";
$wgRightsIcon = "";

# Path to the GNU diff3 utility. Used for conflict resolution.
$wgDiff3 = "/usr/bin/diff3";

## Default skin: you can change the default skin. Use the internal symbolic
## names, ie 'vector', 'monobook':
$wgDefaultSkin = "vector";

# Enabled skins.
# The following skins were automatically enabled:
wfLoadSkin( 'MonoBook' );
wfLoadSkin( 'Timeless' );
wfLoadSkin( 'Vector' );


# End of automatically generated settings.
# Add more configuration options below.

$wgGroupPermissions['*']['edit'] = false;

# -----------------------------------------------------------------------------
# https://www.mediawiki.org/wiki/Extension:ConfirmAccount/de
require_once "$IP/extensions/ConfirmAccount/ConfirmAccount.php";
$wgMakeUserPageFromBio = false;
$wgAutoWelcomeNewUsers = false;
$wgConfirmAccountRequestFormItems = array(
  'UserName'        => array('enabled' => true),
  'RealName'        => array('enabled' => false),
  'Biography'       => array('enabled' => false, 'minWords' => 50 ),
  'AreasOfInterest' => array('enabled' => false),
  'CV'              => array('enabled' => false),
  'Notes'           => array('enabled' => true),
  'Links'           => array('enabled' => false),
  'TermsOfService'  => array('enabled' => false),
);

# -----------------------------------------------------------------------------
# https://www.mediawiki.org/wiki/Extension:WikiCategoryTagCloud
wfLoadExtension('WikiCategoryTagCloud');

# -----------------------------------------------------------------------------
# https://www.mediawiki.org/wiki/Extension:CategoryTree
wfLoadExtension('CategoryTree');

# -----------------------------------------------------------------------------
# https://www.mediawiki.org/wiki/Extension:VisualEditor
wfLoadExtension('VisualEditor');

// Enable by default for everybody
$wgDefaultUserOptions['visualeditor-enable'] = 1;

// Optional: Set VisualEditor as the default for anonymous users
// otherwise they will have to switch to VE
// $wgDefaultUserOptions['visualeditor-editor'] = "visualeditor";

// Don't allow users to disable it
$wgHiddenPrefs[] = 'visualeditor-enable';

// OPTIONAL: Enable VisualEditor's experimental code features
// #$wgDefaultUserOptions['visualeditor-enable-experimental'] = 1;

$wgVirtualRestConfig['modules']['parsoid'] = array(
  // URL to the Parsoid instance
  'url' => 'http://mediawiki-parsoid:8000',
  // Parsoid "domain"
  'domain' => 'heine7'
);

// Make the VisualEditor the default for red links (create new page)
// https://www.mediawiki.org/w/index.php?title=Topic:R9u1ujwknjqxgoxb&topic_showPostId=ufx6qvy2nyikpvwq#flow-post-ufx6qvy2nyikpvwq
$wgHooks['HtmlPageLinkRendererBegin'][] = function ( $linkRenderer, $target, &$text, &$extraAttribs, &$query, &$ret ) {
  $title = Title::newFromLinkTarget( $target );
  if ( !$title->isKnown() ) {
    $query['veaction'] = 'edit';
    $query['action'] = 'view'; // Prevent MediaWiki from overriding veaction
  }
};
