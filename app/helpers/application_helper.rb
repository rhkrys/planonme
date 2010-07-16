# Methods added to this helper will be available to all templates in the application.
module ApplicationHelper
  
  #nav_link will create navigation links
  def nav_link(text, controller, action)
    link_to_unless_current text, :controller => controller, :action => action
  end



end


#
# Comments:
#   I know that I will need navigation links everywhere just about,
#   so I may as well create the helper from the start.