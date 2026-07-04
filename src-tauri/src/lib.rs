mod antigravity;
mod claude_code;
mod docker;
mod fs;
mod git;
mod keys;
mod pty;
mod sandbox;
mod system;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(pty::PtyState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      git::git_full_repository,
      git::git_commit_details,
      git::git_status,
      git::git_checkout_branch,
      pty::spawn_pty,
      pty::write_pty,
      pty::resize_pty,
      pty::kill_pty,
      fs::agent_read_file,
      fs::agent_write_file,
      fs::agent_list_dir,
      fs::agent_grep,
      fs::agent_run_command,
      fs::agent_read_file_bytes,
      fs::read_attachment,
      fs::walk_tree,
      fs::get_provider_key,
      fs::check_cli_provider,
      fs::provider_update,
      antigravity::antigravity_run,
      antigravity::antigravity_kill,
      antigravity::antigravity_check,
      keys::set_secure_key,
      keys::get_secure_key,
      keys::delete_secure_key,
      claude_code::claude_code_run,
      claude_code::claude_code_kill,
      docker::runtime_detect,
      docker::docker_ps,
      docker::docker_compose_services,
      docker::docker_stats_stream,
      docker::docker_logs_stream,
      docker::docker_kill,
      docker::docker_action,
      docker::docker_exec,
      docker::docker_inspect,
      sandbox::sandbox_status,
      sandbox::sandbox_build,
      sandbox::sandbox_ensure,
      sandbox::sandbox_exec,
      sandbox::sandbox_teardown,
      system::system_snapshot,
      system::system_processes,
      system::system_ports,
      system::system_kill,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      // Reap all spawned child processes on exit so we never orphan shells,
      // `claude` CLIs, or `python3` Antigravity bridges when the app closes.
      if let tauri::RunEvent::ExitRequested { .. } = event {
        use tauri::Manager;
        app_handle.state::<pty::PtyState>().kill_all();
        claude_code::kill_all_children();
        antigravity::kill_all_children();
        docker::kill_all_children();
        sandbox::teardown_all();
      }
    });
}
