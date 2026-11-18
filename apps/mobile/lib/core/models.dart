final RegExp _schoolCode = RegExp(r'^[a-z0-9_]{2,40}$');

/// Same rule as the API tenant slug.
bool isValidSchoolCode(String code) => _schoolCode.hasMatch(code.trim().toLowerCase());

class ActiveModule {
  final String name;
  final String version;
  final List<String> permissions;
  final List<String> mobileScreens;
  const ActiveModule(this.name, this.version, this.permissions, this.mobileScreens);

  factory ActiveModule.fromJson(Map<String, dynamic> j) => ActiveModule(
        j['name'] as String,
        j['version'] as String,
        List<String>.from(j['permissions'] as List? ?? const []),
        List<String>.from(j['mobile_screens'] as List? ?? const []),
      );
}

/// Screens to display = union of screens declared by the tenant's active modules.
Set<String> visibleScreens(List<ActiveModule> modules) => {for (final m in modules) ...m.mobileScreens};
